const { web3, AnchorProvider, Wallet, Program, BN } = require('@coral-xyz/anchor')
const {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token')

const { queue } = require('./queue')
const { RelayerError, logRelayerError } = require('./utils')
const { jobType, status } = require('./constants')
const { keypair, relayerFee, netId } = require('./config')
const { redis } = require('./modules/redis')
const IDL = require('../idl/arcane.json')
const IDL_DEVNET = require('../idl/arcane-devnet.json')

const commitment = 'confirmed'
const connection = require('./modules/connection')()
const provider = new AnchorProvider(connection, new Wallet(keypair), {
  commitment,
})
const program = new Program(netId === 'devnet' ? IDL_DEVNET : IDL, provider)

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

  const denomination = new BN(job.data.denomination)
  const recipient = new web3.PublicKey(job.data.args[2])
  const relayer = new web3.PublicKey(job.data.args[3])

  const [networkStatePDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('arcane-config')],
    program.programId,
  )
  const networkState = await program.account.networkState.fetch(networkStatePDA)
  const wallets = networkState.config.wallets || []

  const platformFee = denomination
    .mul(new BN(wallets.reduce((acc, wallet) => acc + wallet.feeSplit, 0)))
    .divn(1000000)
  const relayerFeeAmount = denomination.mul(new BN(relayerFee * 100)).divn(1000000)

  const tx = new web3.Transaction()
  if ('mint' in job.data) {
    const mint = new web3.PublicKey(job.data.mint)
    const mintAccountInfo = await provider.connection.getAccountInfo(mint)
    const tokenProgram = mintAccountInfo.owner

    const [tokenPoolPDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), mint.toBuffer(), denomination.toArrayLike(Buffer, 'be', 8)],
      program.programId,
    )

    const preInstructions = await createAssociatedTokenAccountInstructions(
      keypair,
      [recipient, relayer, ...wallets.map(wallet => wallet.address)],
      mint,
      tokenProgram,
    )

    const withdrawIx = await program.methods
      .tokenWithdraw(
        Array.from(Buffer.from(job.data.proof.substring(2), 'hex')),
        Array.from(Buffer.from(job.data.args[0].substring(2), 'hex')),
        Array.from(Buffer.from(job.data.args[1].substring(2), 'hex')),
        new BN(job.data.args[4].substring(2), 'hex'),
        new BN(job.data.args[5].substring(2), 'hex'),
      )
      .accountsPartial({
        recipient,
        relayer,
        pool: tokenPoolPDA,
        mint,
        tokenProgram,
      })
      .remainingAccounts(
        wallets
          .map(wallet => getAssociatedTokenAddressSync(mint, wallet.address, false, tokenProgram))
          .map(pubkey => ({
            pubkey,
            isSigner: false,
            isWritable: true,
          })),
      )
      .instruction()

    tx.add(...preInstructions, withdrawIx)
  } else {
    const [poolPDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), denomination.toArrayLike(Buffer, 'be', 8)],
      program.programId,
    )

    const withdrawIx = await program.methods
      .withdraw(
        Array.from(Buffer.from(job.data.proof.substring(2), 'hex')),
        Array.from(Buffer.from(job.data.args[0].substring(2), 'hex')),
        Array.from(Buffer.from(job.data.args[1].substring(2), 'hex')),
        new BN(job.data.args[4].substring(2), 'hex'),
        new BN(job.data.args[5].substring(2), 'hex'),
      )
      .accountsPartial({
        recipient,
        relayer,
        pool: poolPDA,
      })
      .remainingAccounts(
        wallets
          .map(wallet => wallet.address)
          .map(pubkey => ({
            pubkey,
            isSigner: false,
            isWritable: true,
          })),
      )
      .instruction()

    tx.add(withdrawIx)
  }

  tx.feePayer = relayer
  tx.recentBlockhash = (await provider.connection.getLatestBlockhash(commitment)).blockhash

  const simulationResult = await provider.connection.simulateTransaction(tx, [keypair])

  console.log('--- Withdraw Fee Estimation ---')
  if (simulationResult.value.err) {
    console.error('Transaction simulation failed:')
    console.error(simulationResult.value.logs)
    throw new Error('Estimation error: transaction will possibly be reverted')
  }

  // Calculate fees
  const message = tx.compileMessage()
  const feeResponse = await provider.connection.getFeeForMessage(message, commitment)
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
      preflightCommitment: commitment,
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
          await program.provider.connection.getLatestBlockhash(commitment)
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
        commitment,
        maxSupportedTransactionVersion: 0,
      })
      console.error('Transaction failed with logs:', txDetails.meta.logMessages || [])
      throw new RelayerError(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
    }

    // Update confirmations (Solana doesn't provide a direct "confirmations" count like EVM,
    // but we can simulate it by checking the slot or block height)
    const latestBlockHeight = (await program.provider.connection.getLatestBlockhash(commitment))
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

async function createAssociatedTokenAccountInstructions(
  payer,
  owners,
  mint,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
) {
  const instructions = []
  if (!owners.length) return instructions

  const ownerPubkeys = owners.map(owner =>
    owner instanceof web3.PublicKey ? owner : new web3.PublicKey(owner),
  )

  const ataAddresses = ownerPubkeys.map(owner =>
    getAssociatedTokenAddressSync(mint, owner, false, programId, associatedTokenProgramId),
  )

  const accountsInfo = await connection.getMultipleAccountsInfo(ataAddresses, commitment)

  // Check each account: if missing or wrong owner, add creation instruction
  for (let i = 0; i < ownerPubkeys.length; i++) {
    const accountInfo = accountsInfo[i]
    const exists = accountInfo !== null
    const isOwnedByTokenProgram = exists && accountInfo.owner.equals(programId)

    if (!exists || !isOwnedByTokenProgram) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ataAddresses[i],
          ownerPubkeys[i],
          mint,
          programId,
          associatedTokenProgramId,
        ),
      )
    }
  }

  return instructions
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
