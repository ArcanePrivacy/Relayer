const jobType = Object.freeze({
  ARCANE_WITHDRAW: 'ARCANE_WITHDRAW',
})

const status = Object.freeze({
  QUEUED: 'QUEUED',
  ACCEPTED: 'ACCEPTED',
  SENT: 'SENT',
  MINED: 'MINED',
  RESUBMITTED: 'RESUBMITTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
})

module.exports = {
  jobType,
  status,
}
