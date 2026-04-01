const { BN, web3 } = require('@coral-xyz/anchor')

const sleep = ms => new Promise(res => setTimeout(res, ms))

function setSafeInterval(func, interval) {
  func()
    .catch(console.error)
    .finally(() => {
      setTimeout(() => setSafeInterval(func, interval), interval)
    })
}

class RelayerError extends Error {
  constructor(message, score = 0) {
    super(message)
    this.score = score
  }
}

const logRelayerError = async (redis, e) => {
  await redis.zadd('errors', 'INCR', e.score || 1, e.message)
}

const readRelayerErrors = async redis => {
  const set = await redis.zrevrange('errors', 0, -1, 'WITHSCORES')
  const errors = []
  while (set.length) {
    const [message, score] = set.splice(0, 2)
    errors.push({ message, score })
  }
  return errors
}

const fromLamports = lamports => {
  if (!lamports) {
    return '0'
  }
  return new BN(lamports).div(new BN(web3.LAMPORTS_PER_SOL)).toString()
}

module.exports = {
  setSafeInterval,
  sleep,
  RelayerError,
  logRelayerError,
  readRelayerErrors,
  fromLamports,
}
