require('dotenv').config()
const { web3 } = require('@coral-xyz/anchor')
const { default: bs58 } = require('bs58')

module.exports = {
  netId: process.env.NET_ID || 'devnet',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  rpcUrl: process.env.RPC_URL,
  merkleTreeHeight: 20,
  keypair: web3.Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY)),
  port: process.env.APP_PORT || 8000,
  relayerFee: Number(process.env.RELAYER_FEE),
  PRIORITY_FEE_PER_CU_MICRO_LAMPORTS: Number(process.env.PRIORITY_FEE_PER_CU_MICRO_LAMPORTS),
  minimumBalance: web3.LAMPORTS_PER_SOL * 0.02,
}
