const test = require('tape')
const { createOne, createMany } = require('./helpers/create')

test('can replicate one core between two daemons', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]

  const core1 = client1.corestore.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  const core2 = client2.corestore.get(core1.key)
  await core2.ready()
  await client2.network.configure(core1.discoveryKey, { announce: false, lookup: true })
  const block = await core2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('announced discovery key is rejoined on restart', async t => {
  const { bootstrapOpt, clients, servers, cleanup, dirs } = await createMany(2)

  var client1 = clients[0]
  var server1 = servers[0]
  const client2 = clients[1]

  const core1 = client1.corestore.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true, remember: true })

  await server1.close()
  const newServer = await createOne({ dir: dirs[0], bootstrap: bootstrapOpt })
  client1 = newServer.client
  server1 = newServer.server

  const core2 = client2.corestore.get(core1.key)
  await core2.ready()
  await client2.network.configure(core1.discoveryKey, { announce: false, lookup: true })
  const block = await core2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await server1.close()
  await cleanup()
  t.end()
})

test('peers are set on a remote hypercore', async t => {
  const { clients, servers, cleanup } = await createMany(5)
  const firstPeerRemoteKey = servers[0].networker.keyPair.publicKey

  const client1 = clients[0]
  const core1 = client1.corestore.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < clients.length; i++) {
    const client = clients[i]
    const core = client.corestore.get(core1.key)
    await core.ready()
    const peerAddProm = new Promise(resolve => {
      let opened = 0
      const openedListener = peer => {
        t.true(peer.remotePublicKey.equals(firstPeerRemoteKey))
        if (++opened === 1) {
          core.removeListener('peer-open', openedListener)
          return resolve()
        }
        return null
      }
      core.on('peer-open', openedListener)
    })
    await client.network.configure(core1.discoveryKey, { announce: false, lookup: true })
    await peerAddProm
  }

  await cleanup()
  t.end()
})

test('can get a stored network configuration', async t => {
  // TODO: Figure out DHT error when doing a swarm join with bootstrap: false
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const core = client.corestore.get()
  await core.ready()
  await client.network.configure(core.discoveryKey, { announce: true, lookup: true, flush: true, remember: true })

  const config = await client.network.getConfiguration(core.discoveryKey)
  t.true(config.discoveryKey.equals(core.discoveryKey))
  t.true(config.announce)
  t.true(config.lookup)

  await cleanup()
  t.end()
})

test('can get a transient network configuration', async t => {
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const core = client.corestore.get()
  await core.ready()
  await client.network.configure(core.discoveryKey, { announce: false, lookup: true, flush: true, remember: false })

  const config = await client.network.getConfiguration(core.discoveryKey)
  t.true(config.discoveryKey.equals(core.discoveryKey))
  t.false(config.announce)
  t.true(config.lookup)

  await cleanup()
  t.end()
})

test('can get all network configurations', async t => {
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const core1 = client.corestore.get()
  const core2 = client.corestore.get()
  const core3 = client.corestore.get()
  await core1.ready()
  await core2.ready()
  await core3.ready()

  await client.network.configure(core1.discoveryKey, { announce: false, lookup: true, flush: true, remember: false })
  await client.network.configure(core2.discoveryKey, { announce: false, lookup: true, flush: true, remember: true })
  await client.network.configure(core3.discoveryKey, { announce: true, lookup: true, flush: true, remember: false })

  const configs = await client.network.getAllConfigurations()
  t.same(configs.length, 3)
  let remembers = 0
  let announces = 0
  let lookups = 0
  for (const config of configs) {
    if (config.remember) remembers++
    if (config.announce) announces++
    if (config.lookup) lookups++
  }

  t.same(lookups, 3)
  t.same(announces, 1)
  t.same(remembers, 1)

  await cleanup()
  t.end()
})

test('can get swarm-level networking events', async t => {
  const { clients, servers, cleanup } = await createMany(5)

  const client1 = clients[0]
  const core1 = client1.corestore.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  let opened = 0
  let closed = 0
  const openProm = new Promise(resolve => {
    const openListener = peer => {
      if (++opened === 4) return resolve()
      return null
    }
    client1.network.on('peer-open', openListener)
  })
  const closeProm = new Promise(resolve => {
    const removeListener = (peer) => {
      if (++closed === 4) return resolve()
      return null
    }
    client1.network.on('peer-remove', removeListener)
  })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < clients.length; i++) {
    const client = clients[i]
    const core = client.corestore.get(core1.key)
    await core.ready()
    await client.network.configure(core1.discoveryKey, { announce: false, lookup: true })
  }

  await openProm

  for (let i = 1; i < servers.length; i++) {
    await servers[i].close()
  }

  await closeProm

  t.pass('all open/remove events were fired')
  await cleanup()
  t.end()
})

test('an existing core is opened with peers', async t => {
  const { clients, cleanup } = await createMany(5)

  const client1 = clients[0]
  const core1 = client1.corestore.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  let opened = 0
  const openProm = new Promise(resolve => {
    const openListener = peer => {
      if (++opened === 4) return resolve()
      return null
    }
    client1.network.on('peer-open', openListener)
  })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < clients.length; i++) {
    const client = clients[i]
    const core = client.corestore.get(core1.key)
    await core.ready()
    await client.network.configure(core1.discoveryKey, { announce: false, lookup: true })
  }

  await openProm

  const core2 = client1.corestore.get(core1.key)
  await core2.ready()
  // Peers should be set immediately after ready.
  t.same(core2.peers.length, 4)

  await cleanup()
  t.end()
})
