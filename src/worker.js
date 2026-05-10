const { web3, AnchorProvider, Wallet, Program, BN } = require('@coral-xyz/anchor')

const { queue } = require('./queue')
const { RelayerError, logRelayerError } = require('./utils')
const { jobType, status } = require('./constants')
const { keypair, relayerFee } = require('./config')
const { getOracleQuote } = require('./modules/rangeSDK')
const { redis } = require('./modules/redis')
const idl = require('../idl/arcane.json')

const connection = require('./modules/connection')()
const provider = new AnchorProvider(connection, new Wallet(keypair), {
  commitment: 'confirmed',
})
const program = new Program(idl, provider)

let currentJob

async function start() {
  try {
    await clearErrors()
    queue.process(processJob)
    console.log('Worker started')
  } catch (e) {
    await logRelayerError(redis, e)
    console.error('error on start worker', e.message)
  }
}

async function checkRecipient({ data }) {
  // Checks only for default withdrawals
  if (data.type !== jobType.ARCANE_WITHDRAW) return

  const recipient = data.args[2]
  try {
    const publicKey = new web3.PublicKey(recipient)
    const accountInfo = await connection.getAccountInfo(publicKey)

    if (accountInfo && accountInfo.executable) {
      throw new Error('Recipient cannot be a program, only a system account')
    }
  } catch (e) {
    throw new Error(`Recipient address is invalid: ${e.message}`)
  }
}

async function processJob(job) {
  try {
    if (!jobType[job.data.type]) {
      throw new RelayerError(`Unknown job type: ${job.data.type}`)
    }
    currentJob = job
    await updateStatus(status.ACCEPTED)
    console.log(`Start processing a new ${job.data.type} job #${job.id}`)
    await submitTx(job)
  } catch (e) {
    console.error('processJob', e.message)
    await updateStatus(status.FAILED)
    throw new RelayerError(e.message)
  }
}

async function submitTx(job) {
  await checkRecipient(job)

  const [networkStatePDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('arcane-config')],
    program.programId,
  )
  const [treasuryPDA] = web3.PublicKey.findProgramAddressSync([Buffer.from('treasury')], program.programId)
  const [poolPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), new BN(job.data.denomination).toArrayLike(Buffer, 'be', 8)],
    program.programId,
  )
  const [nullifierPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), Buffer.from(job.data.args[1].substring(2), 'hex')],
    program.programId,
  )

  const recipient = new web3.PublicKey(job.data.args[2])
  const relayer = new web3.PublicKey(job.data.args[3])

  const networkState = await program.account.networkState.fetch(networkStatePDA)
  const platformFee = new BN(job.data.denomination)
    .mul(new BN(networkState.config.wallets.reduce((acc, wallet) => acc + wallet.feeSplit, 0)))
    .divn(1000000)
  const relayerFeeAmount = new BN(job.data.denomination).mul(new BN(relayerFee * 100)).divn(1000000)

  const { queueAccount, sigVerifyIx } = await getOracleQuote(keypair, recipient.toBase58())

  const withdrawIx = await program.methods
    .withdraw(
      Array.from(Buffer.from(job.data.proof.substring(2), 'hex')),
      Array.from(Buffer.from(job.data.args[0].substring(2), 'hex')),
      Array.from(Buffer.from(job.data.args[1].substring(2), 'hex')),
      new BN(job.data.args[4].substring(2), 'hex'),
      new BN(job.data.args[5].substring(2), 'hex'),
    )
    .accounts({
      recipient,
      relayer,
      pool: poolPDA,
      networkState: networkStatePDA,
      treasury: treasuryPDA,
      nullifier: nullifierPDA,
      queue: queueAccount,
      slotHashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
      instructions: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: web3.SystemProgram.programId,
    })
    .remainingAccounts(
      networkState.config.wallets
        .map(wallet => wallet.address)
        .map(pubkey => ({
          pubkey,
          isSigner: false,
          isWritable: true,
        })),
    )
    .instruction()

  const tx = new web3.Transaction().add(sigVerifyIx).add(withdrawIx)

  tx.feePayer = relayer
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash('confirmed')).blockhash

  const simulationResult = await provider.connection.simulateTransaction(tx, [keypair])

  console.log('--- Withdraw Fee Estimation ---')
  if (simulationResult.value.err) {
    console.error('Transaction simulation failed:')
    console.error(simulationResult.value.logs)
    throw new Error('Estimation error: transaction will possibly be reverted')
  }

  // Calculate fees
  const message = tx.compileMessage()
  const feeResponse = await provider.connection.getFeeForMessage(message, 'confirmed')
  const baseFee = feeResponse.value
  const totalEstimatedFee = baseFee

  if (
    platformFee
      .add(relayerFeeAmount)
      .add(new BN(totalEstimatedFee))
      .gt(new BN(job.data.args[4].substring(2), 'hex'))
  ) {
    throw new RelayerError(
      'Provided fee is not enough. Probably it is a Gas Price spike, try to resubmit.',
      0,
    )
  }

  try {
    tx.partialSign(keypair)
    const signature = await program.provider.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false, // Run preflight checks to catch errors early
      preflightCommitment: 'confirmed',
    })

    // Update transaction hash (signature in Solana)
    void updateTxHash(signature)
    void updateStatus(status.SENT)

    console.log('Transaction sent with signature:', signature)

    // Confirm the transaction
    const confirmation = await program.provider.connection.confirmTransaction(
      {
        signature,
        blockhash: tx.recentBlockhash,
        lastValidBlockHeight: (
          await program.provider.connection.getLatestBlockhash('confirmed')
        ).lastValidBlockHeight,
      },
      'finalized', // Commitment level
    )

    void updateStatus(status.MINED)
    console.log('Transaction mined with signature:', signature)

    // Check confirmation status
    if (confirmation.value.err) {
      // Fetch transaction details for better error logging
      const txDetails = await program.provider.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      console.error('Transaction failed with logs:', txDetails.meta.logMessages || [])
      throw new RelayerError(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
    }

    // Update confirmations (Solana doesn't provide a direct "confirmations" count like EVM,
    // but we can simulate it by checking the slot or block height)
    const latestBlockHeight = (await program.provider.connection.getLatestBlockhash('confirmed'))
      .lastValidBlockHeight
    const txBlockHeight = confirmation.context.slot
    const confirmations = latestBlockHeight - txBlockHeight + 1
    void updateConfirmations(confirmations)

    // Update status to confirmed if successful
    await updateStatus(status.CONFIRMED)
    console.log('Transaction confirmed in slot', txBlockHeight)
  } catch (e) {
    console.error('Transaction error:', e)
    throw new RelayerError(`Transaction reverted: ${e.message}`)
  }
}

async function updateTxHash(txHash) {
  console.log(`A new successfully sent tx ${txHash}`)
  currentJob.data.txHash = txHash
  await currentJob.update(currentJob.data)
}

async function updateConfirmations(confirmations) {
  console.log(`Confirmations count ${confirmations}`)
  currentJob.data.confirmations = confirmations
  await currentJob.update(currentJob.data)
}

async function updateStatus(status) {
  console.log(`Job status updated ${status}`)
  currentJob.data.status = status
  await currentJob.update(currentJob.data)
}

async function clearErrors() {
  console.log('Errors list cleared')
  await redis.del('errors')
}

void start()
