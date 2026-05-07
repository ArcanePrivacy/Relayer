const connection = require('./connection')()

const getNetwork = async () => {
  const genesisHash = await connection.getGenesisHash()

  switch (genesisHash) {
    case '5eykt4UsFv8P8NJdTREpY1vzqAQXYLSmZYy1A6J3m9rR':
      return 'mainnet-beta'
    case 'EtWTRABG3VvSndmxsXfM8nNZYzSnf3SFTN7pM469dqR6':
      return 'devnet'
    case '4uhcV6fTT89YvY56747Y9j8o8sWfK4eT54zM2X7oMT':
      return 'testnet'
    default:
      return 'unknown (possible localnet or private cluster)'
  }
}

module.exports = getNetwork
