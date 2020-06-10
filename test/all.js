const test = require('tape')
const HyperspaceClient = require('../client')
const HyperspaceServer = require('../server')

test('can open a core', async t => {
  const server = new HyperspaceServer()
  await server.ready()

  const client = new HyperspaceClient()
  await client.ready()

  const core = client.get()
  await core.ready()

  t.same(core.byteLength, 0)
  t.same(core.length, 0)
  t.same(core.key.length, 32)
  t.same(core.discoveryKey.length, 32)

  await client.close()
  await server.close()
  t.end()
})

test('can get a block', async t => {
  const server = new HyperspaceServer()
  await server.ready()

  const client = new HyperspaceClient()
  await client.ready()

  const core = client.get()
  await core.ready()

  t.same(core.byteLength, 0)
  t.same(core.length, 0)
  t.same(core.key.length, 32)
  t.same(core.discoveryKey.length, 32)

  await client.close()
  await server.close()
  t.end()
})


