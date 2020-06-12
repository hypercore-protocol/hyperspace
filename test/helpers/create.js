const tmp = require('tmp-promise')
const dht = require('@hyperswarm/dht')
const RemoteCorestore = require('../../client')
const HyperspaceServer = require('../../server')

const BASE_PORT = 4101
const BOOTSTRAP_PORT = 3106
const BOOTSTRAP_URL = `localhost:${BOOTSTRAP_PORT}`

async function createOne (opts = {}) {
  const tmpDir = opts.dir || await tmp.dir({ unsafeCleanup: true })
  const server = new HyperspaceServer({ storage: tmpDir.path, network: { bootstrap: opts.bootstrap || false } })
  await server.ready()

  const store = new RemoteCorestore()
  await store.ready()

  const cleanup = () => Promise.all([
    tmpDir.cleanup(),
    server.close(),
    store.close()
  ])

  return { server, store, cleanup, dir: tmpDir }
}

async function createMany (numDaemons, opts) {
  const cleanups = []
  const stores = []
  const servers = []
  const dirs = []

  const bootstrapOpt = [BOOTSTRAP_URL]
  const bootstrapper = dht({
    bootstrap: false
  })
  bootstrapper.listen(BOOTSTRAP_PORT)
  await new Promise(resolve => {
    return bootstrapper.once('listening', resolve)
  })

  for (let i = 0; i < numDaemons; i++) {
    const { server, store, cleanup, dir } = await createOne({ bootstrap: bootstrapOpt })
    cleanups.push(cleanup)
    servers.push(server)
    stores.push(store)
    dirs.push(dir)
  }

  return { stores, servers, cleanup, dirs, bootstrapOpt }

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
