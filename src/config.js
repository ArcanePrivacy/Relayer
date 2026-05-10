require('dotenv').config()
const { web3 } = require('@coral-xyz/anchor')
const { default: bs58 } = require('bs58')

function assertByteArray(value) {
  if (!Array.isArray(value)) {
    throw new Error('PRIVATE_KEY JSON must be an array of byte values (0-255).')
  }
  if (value.length !== 64) {
    throw new Error(`PRIVATE_KEY must contain exactly 64 bytes. Received: ${value.length}`)
  }
  if (!value.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new Error(
      'PRIVATE_KEY contains invalid byte values. Each item must be an integer between 0 and 255.',
    )
  }
}

function parsePrivateKey(input) {
  if (!input || !String(input).trim()) {
    throw new Error('PRIVATE_KEY is required.')
  }

  const key = String(input).trim()

  // JSON array format: [159,24,...]
  if (key.startsWith('[') && key.endsWith(']')) {
    const parsed = JSON.parse(key)
    assertByteArray(parsed)
    return Uint8Array.from(parsed)
  }

  // Comma-separated decimal bytes: 159,24,...
  if (key.includes(',')) {
    const parsed = key.split(',').map(v => Number(v.trim()))
    assertByteArray(parsed)
    return Uint8Array.from(parsed)
  }

  // Hex format: 0x...
  if (/^0x[0-9a-fA-F]+$/.test(key)) {
    const hex = key.slice(2)
    if (hex.length !== 128) {
      throw new Error(
        `PRIVATE_KEY hex must contain 64 bytes (128 hex chars). Received: ${hex.length} hex chars`,
      )
    }
    return Uint8Array.from(Buffer.from(hex, 'hex'))
  }

  // Default to base58.
  const decoded = bs58.decode(key)
  if (decoded.length !== 64) {
    throw new Error(`PRIVATE_KEY base58 must decode to 64 bytes. Received: ${decoded.length}`)
  }
  return decoded
}

const rangeApiKey = process.env.RANGE_API_KEY
if (!rangeApiKey || !String(rangeApiKey).trim()) {
  throw new Error('RANGE_API_KEY is required.')
}

module.exports = {
  netId: process.env.NET_ID || 'mainnet-beta',
  rpcUrl: process.env.RPC_URL,
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  merkleTreeHeight: 20,
  keypair: web3.Keypair.fromSecretKey(parsePrivateKey(process.env.PRIVATE_KEY)),
  port: process.env.APP_PORT || 8000,
  relayerFee: Number(process.env.RELAYER_FEE),
  minimumBalance: web3.LAMPORTS_PER_SOL * 0.02,
}
