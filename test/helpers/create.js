const tmp = require('tmp-promise')
const dht = require('@hyperswarm/dht')
const HyperspaceClient = require('../../client')
const HyperspaceServer = require('../../server')

async function createOne (opts = {}) {
  const tmpDir = opts.dir || await tmp.dir({ unsafeCleanup: true })
  const server = new HyperspaceServer({
    ...opts,
    storage: tmpDir.path,
    network: {
      bootstrap: opts.bootstrap || false,
      preferredPort: 0
    },
    noMigrate: true
  })
  await server.ready()

  const client = new HyperspaceClient({ host: opts.host, port: opts.port })
  await client.ready()

  const cleanup = async () => {
    await client.close()
    await server.close()
    await tmpDir.cleanup()
  }

  return { server, client, cleanup, dir: tmpDir }
}

async function createMany (numDaemons, opts) {
  const cleanups = []
  const clients = []
  const servers = []
  const dirs = []

  const bootstrapper = dht({
    bootstrap: false
  })
  bootstrapper.listen()
  await new Promise(resolve => {
    return bootstrapper.once('listening', resolve)
  })
  const bootstrapPort = bootstrapper.address().port
  const bootstrapOpt = [`localhost:${bootstrapPort}}`]

  for (let i = 0; i < numDaemons; i++) {
    const serverOpts = opts ? Array.isArray(opts) ? opts[i] : opts : null
    const { server, client, cleanup, dir } = await createOne({ ...serverOpts, bootstrap: bootstrapOpt, host: 'hyperspace-' + i })
    cleanups.push(cleanup)
    servers.push(server)
    clients.push(client)
    dirs.push(dir)
  }

  return { clients, servers, cleanup, dirs, bootstrapOpt }

  async function cleanup (opts) {
    for (const cleanupInstance of cleanups) {
      await cleanupInstance(opts)
    }
    await bootstrapper.destroy()
  }
}

module.exports = {
  createOne,
  createMany
}
