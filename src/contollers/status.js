const queue = require('../queue')
const { netId, relayerFee, keypair } = require('../config')
const { version } = require('../../package.json')
const { redis } = require('../modules/redis')
const { readRelayerErrors } = require('../utils')

async function status(req, res) {
  const health = await redis.hgetall('health')
  health.errorsLog = await readRelayerErrors(redis)
  const { waiting: currentQueue } = await queue.queue.getJobCounts()

  res.json({
    netId,
    rewardAccount: keypair.publicKey.toString(),
    relayerFee,
    version,
    health,
    currentQueue,
  })
}

function index(req, res) {
  res.send(
    'This is <a href=https://arcaneprivacy.com>Arcane Privacy</a> Relayer service. Check the <a href=/v1/status>/status</a> for settings',
  )
}

async function getJob(req, res) {
  const status = await queue.getJobStatus(req.params.id)
  return status ? res.json(status) : res.status(400).json({ error: "The job doesn't exist" })
}

module.exports = {
  status,
  index,
  getJob,
}
