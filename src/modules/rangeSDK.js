const { CrossbarClient, OracleJob } = require('@switchboard-xyz/common')
const sb = require('@switchboard-xyz/on-demand')
const { rpcUrl, netId } = require('../config')

// Oracle Job to fetch Range Risk Score for a given address
// The oracle job uses an HTTP task to fetch the risk score from Range API
// and then parses the JSON response to extract the riskScore field.
// The riskScore is then multiplied by 10 to convert it to a scale of 0-100
// and bounded between 0 and 100.
// The API key is passed as a variable override to the oracle job.
const getRangeRiskScoreJob = address => {
  return OracleJob.fromObject({
    tasks: [
      {
        httpTask: {
          url: `https://api.range.org/v1/risk/address?address=${address}&network=solana`,
          headers: [
            { key: 'accept', value: 'application/json' },
            // Resolved by Switchboard oracle via variable override - never On-chain
            { key: 'X-API-KEY', value: '${RANGE_API_KEY}' },
          ],
        },
      },
      // Extract the numeric risk score from the response
      { jsonParseTask: { path: '$.riskScore' } },
      // Scale from 0 to 10 to 0–100 for integer precision On-chain
      { multiplyTask: { scalar: 10 } },
      // Bound the result
      {
        boundTask: {
          lowerBoundValue: '0',
          onExceedsLowerBoundValue: '0',
          upperBoundValue: '100',
          onExceedsUpperBoundValue: '100',
        },
      },
    ],
  })
}

// Fetch a signed oracle quote **and** build the Ed25519 signature verification
// Flow:
// 1) Choose the queue (devnet in this example)
// 2) Construct a canonical feed (IOracleFeed) with your OracleJob
// 3) Store feed on Crossbar to get canonical `feedId` (deterministic hash of feed proto)
// 4) Build the Ed25519 verify ix using `queue.fetchQuoteIx`, pointing at `feedId`
//    and passing `variableOverrides` so oracles can resolve `${RANGE_API_KEY}`
//
// The returned `sigVerifyIx` is the Ed25519 signature verification
const getOracleQuote = async (payer, addressToCheck) => {
  // Get the queue for the network you're deploying on
  //
  // Devnet queue (use `getDefaultQueue(rpcUrl)` for mainnet)
  let queue = netId === 'devnet' ? await sb.getDefaultDevnetQueue(rpcUrl) : await sb.getDefaultQueue(rpcUrl)

  // Crossbar is the metadata & distribution layer (IPFS pinning + REST operations)
  // It provides essential functionalities for simulating and resolving feeds.
  //
  let crossbar_client = CrossbarClient.default()

  // Build  IOracleFeed (feed proto) from your job(s)
  // Keep values minimal and consistent; defaults vs explicit values can change the hash.
  const feed = {
    name: 'Risk Score',
    jobs: [getRangeRiskScoreJob(addressToCheck)],
    minJobResponses: 1,
    minOracleSamples: 1,
    maxJobRangePct: 100,
  }

  // Build the Ed25519 signature verification instruction for the selected feed.
  // This instruction verifies signatures from guardians and embeds receipts for your
  // on-chain `QuoteVerifier` to parse.
  //
  // Notes:
  // - `variableOverrides` are passed to oracles so `${RANGE_API_KEY}` can be injected
  //   into your HTTP task at runtime (without exposing secrets on-chain).
  // - `numSignatures` controls consensus level; keep >1 for production critical paths.
  // - `instructionIdx` tells the Ed25519 program where to put the sig verify in the tx
  const sigVerifyIx = await queue.fetchQuoteIx(crossbar_client, [feed], {
    variableOverrides: { RANGE_API_KEY: process.env.RANGE_API_KEY },
    numSignatures: 1,
    instructionIdx: 0, // Ed25519 verify must be at this index in the transaction
  })
  return { queueAccount: queue.pubkey, sigVerifyIx }
}

module.exports = {
  getOracleQuote,
}
