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

test('peers are set on a remote hypercore', async t => {
  const { stores, servers, cleanup } = await createMany(5)
  const firstPeerRemoteKey = servers[0].networker.keyPair.publicKey

  const store1 = stores[0]
  const core1 = store1.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await store1.configureNetwork(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < stores.length; i++) {
    const store = stores[i]
    const core = store.get(core1.key)
    await core.ready()
    let peerAddProm = new Promise(resolve => {
      let opened = 0
      const openedListener = peer => {
        t.true(peer.remotePublicKey.equals(firstPeerRemoteKey))
        if (++opened === 1) {
          core.removeListener('peer-open', openedListener)
          return resolve()
        }
      }
      core.on('peer-open', openedListener)
    })
    await store.configureNetwork(core1.discoveryKey, { announce: false, lookup: true })
    await peerAddProm
  }

  await cleanup()
  t.end()
})
