const { web3 } = require('@coral-xyz/anchor')
const { rpcUrl } = require('../config')

const getConnection = () => {
  if (!rpcUrl) {
    throw new Error('RPC_URL is not set. Please set it in your .env file')
  }

  const commitment = 'confirmed'
  const config = {
    commitment,
  }

  if (rpcUrl.startsWith('wss://')) {
    config.wsEndpoint = rpcUrl
  }

  return new web3.Connection(rpcUrl.replace('wss://', 'https://'), config)
}

module.exports = getConnection
