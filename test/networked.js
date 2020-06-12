const test = require('tape')
const { createOne, createMany } = require('./helpers/create')

test('can replicate one core between two daemons', async t => {
  const { stores, servers, cleanup } = await createMany(2)

  const store1 = stores[0]
  const store2 = stores[1]

  const core1 = store1.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await store1.configureNetwork(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  const core2 = store2.get(core1.key)
  await core2.ready()
  await store2.configureNetwork(core1.discoveryKey, { announce: false, lookup: true })
  const block = await core2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('announced discovery key is rejoined on restart', async t => {
  const { bootstrapOpt, stores, servers, cleanup, dirs } = await createMany(2)

  var store1 = stores[0]
  var server1 = servers[0]
  const store2 = stores[1]

  const core1 = store1.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await store1.configureNetwork(core1.discoveryKey, { announce: true, lookup: true, flush: true, remember: true })

  await server1.close()
  const newServer = await createOne({ dir: dirs[0], bootstrap: bootstrapOpt })
  store1 = newServer.store
  server1 = newServer.server

  const core2 = store2.get(core1.key)
  await core2.ready()
  await store2.configureNetwork(core1.discoveryKey, { announce: false, lookup: true })
  const block = await core2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await server1.close()
  await cleanup()
  t.end()
})
