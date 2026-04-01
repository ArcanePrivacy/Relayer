const { PublicKey } = require('@coral-xyz/anchor')
const { keypair } = require('../config')

const Ajv = require('ajv')
const ajv = new Ajv({ format: 'fast' })

ajv.addKeyword('isAddress', {
  validate: (schema, data) => {
    try {
      new PublicKey(data)
      return true
    } catch (e) {
      return false
    }
  },
  errors: true,
})

ajv.addKeyword('isFeeRecipient', {
  validate: (schema, data) => {
    try {
      return keypair.publicKey.toString() === data
    } catch (e) {
      return false
    }
  },
  errors: true,
})

const addressType = { type: 'string', pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$' }
const proofType = { type: 'string', pattern: '^0x[a-fA-F0-9]{512}$' }
const bytes32Type = { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' }
const relayerType = { ...addressType, isFeeRecipient: true }

const arcaneWithdrawSchema = {
  type: 'object',
  properties: {
    proof: proofType,
    denomination: { type: 'string', pattern: '^[0-9]+$' },
    args: {
      type: 'array',
      maxItems: 6,
      minItems: 6,
      items: [bytes32Type, bytes32Type, addressType, relayerType, bytes32Type, bytes32Type],
    },
  },
  additionalProperties: false,
  required: ['proof', 'denomination', 'args'],
}

const validateArcaneWithdraw = ajv.compile(arcaneWithdrawSchema)

function getInputError(validator, data) {
  validator(data)
  if (validator.errors) {
    const error = validator.errors[0]
    return `${error.dataPath} ${error.message}`
  }
  return null
}

function getArcaneWithdrawInputError(data) {
  return getInputError(validateArcaneWithdraw, data)
}

module.exports = {
  getArcaneWithdrawInputError,
}
