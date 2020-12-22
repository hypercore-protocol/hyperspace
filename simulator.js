const ram = require('random-access-memory')

const { Server, Client } = require('.')

module.exports = async function createHyperspaceSimulator () {
  const simulatorId = `hyperspace-simulator-${process.pid}`

  const server = new Server({
    host: simulatorId,
    storage: ram,
    noMigrate: true
  })
  await server.open()

  const client = new Client({
    host: simulatorId
  })

  return { client, server, cleanup }

  async function cleanup () {
    if (client) await client.close()
    if (server) await server.close()
  }
}
