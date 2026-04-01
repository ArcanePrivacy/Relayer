const { BN } = require('@coral-xyz/anchor')
const { setSafeInterval, fromLamports, RelayerError } = require('./utils')
const { keypair, minimumBalance } = require('./config')
const { redis } = require('./modules/redis')
const connection = require('./modules/connection')()

async function main() {
  try {
    const balance = await connection.getBalance(keypair.publicKey)
    if (new BN(balance).lt(new BN(minimumBalance))) {
      throw new RelayerError(`Not enough balance, less than ${fromLamports(minimumBalance)} SOL`, 1)
    }

    await redis.hset('health', { status: true, error: '' })
  } catch (e) {
    console.error('healthWatcher', e.message)
    await redis.hset('health', { status: false, error: e.message })
  }
}

setSafeInterval(main, 30 * 1000)
