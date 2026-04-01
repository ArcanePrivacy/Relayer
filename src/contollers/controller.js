const { getArcaneWithdrawInputError } = require('../modules/validator')
const { postJob } = require('../queue')
const { jobType } = require('../constants')

async function arcaneWithdraw(req, res) {
  const inputError = getArcaneWithdrawInputError(req.body)
  if (inputError) {
    console.log('Invalid input:', inputError)
    return res.status(400).json({ error: inputError })
  }

  const id = await postJob({
    type: jobType.ARCANE_WITHDRAW,
    request: req.body,
  })
  return res.json({ id })
}

module.exports = {
  arcaneWithdraw,
}
