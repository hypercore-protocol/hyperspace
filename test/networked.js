const test = require('tape')
const hypercoreCrypto = require('hypercore-crypto')
const { createOne, createMany } = require('./helpers/create')

test('can replicate one core between two daemons', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const corestore1 = client1.corestore()
  const corestore2 = client2.corestore()

  const core1 = corestore1.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  const core2 = corestore2.get(core1.key)
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
  const corestore1 = client1.corestore()
  const corestore2 = client2.corestore()

  const core1 = corestore1.get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true, remember: true })

  await server1.close()
  const newServer = await createOne({ dir: dirs[0], bootstrap: bootstrapOpt })
  client1 = newServer.client
  server1 = newServer.server

  const core2 = corestore2.get(core1.key)
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

  const corestores = clients.map(c => c.corestore())
  const client1 = clients[0]
  const core1 = corestores[0].get()
  await core1.ready()
  await core1.append(Buffer.from('hello world', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  // Create 4 more peers, and each one should only connect to the first.
  for (let i = 1; i < clients.length; i++) {
    const client = clients[i]
    const corestore = corestores[i]
    const core = corestore.get(core1.key)
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

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()
  await client.network.configure(core.discoveryKey, { announce: true, lookup: true, flush: true, remember: true })

  const status = await client.network.status(core.discoveryKey)
  t.true(status.discoveryKey.equals(core.discoveryKey))
  t.true(status.announce)
  t.true(status.lookup)

  await cleanup()
  t.end()
})

test('can get a transient network configuration', async t => {
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()
  await client.network.configure(core.discoveryKey, { announce: false, lookup: true, flush: true, remember: false })

  const status = await client.network.status(core.discoveryKey)
  t.true(status.discoveryKey.equals(core.discoveryKey))
  t.false(status.announce)
  t.true(status.lookup)

  await cleanup()
  t.end()
})

test('can get all network configurations', async t => {
  const { clients, cleanup } = await createMany(1)
  const client = clients[0]

  const core1 = client.corestore().get()
  const core2 = client.corestore().get()
  const core3 = client.corestore().get()
  await core1.ready()
  await core2.ready()
  await core3.ready()

  await client.network.configure(core1.discoveryKey, { announce: false, lookup: true, flush: true, remember: false })
  await client.network.configure(core2.discoveryKey, { announce: false, lookup: true, flush: true, remember: true })
  await client.network.configure(core3.discoveryKey, { announce: true, lookup: true, flush: true, remember: false })

  const statuses = await client.network.allStatuses()
  t.same(statuses.length, 3)
  let remembers = 0
  let announces = 0
  let lookups = 0
  for (const status of statuses) {
    if (status.remember) remembers++
    if (status.announce) announces++
    if (status.lookup) lookups++
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
  const core1 = client1.corestore().get()
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
    const core = client.corestore().get(core1.key)
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
  const core1 = client1.corestore().get()
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
    const core = client.corestore().get(core1.key)
    await core.ready()
    await client.network.configure(core1.discoveryKey, { announce: false, lookup: true })
  }

  await openProm

  const core2 = client1.corestore().get(core1.key)
  await core2.ready()
  // Peers should be set immediately after ready.
  t.same(core2.peers.length, 4)

  await cleanup()
  t.end()
})

test('can send on a network extension', async t => {
  const { clients, cleanup } = await createMany(3)
  const extensionName = 'test-extension'

  const client1 = clients[0]
  const client2 = clients[1]
  const client3 = clients[2]
  let oneReceived = 0
  let twoReceived = 0

  const sharedKey = hypercoreCrypto.randomBytes(32)

  const ext1 = client1.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-0')
      oneReceived++
    }
  })

  client2.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-1')
      twoReceived++
    }
  })

  const ext3 = client3.network.registerExtension(extensionName, {
    encoding: 'utf8'
  })

  await client3.network.configure(sharedKey, { announce: true, lookup: true })
  await client1.network.configure(sharedKey, { announce: false, lookup: true })
  await client2.network.configure(sharedKey, { announce: false, lookup: true })

  await delay(100)

  for (let i = 0; i < client3.network.peers.length; i++) {
    ext3.send('hello-' + i, client3.network.peers[i])
  }

  await delay(100)

  // Destroy the first extension and make sure it doesn't trigger onmessage again.
  ext1.destroy()
  ext3.send('another world', client3.network.peers[0])

  await delay(100)

  t.same(oneReceived, 1)
  t.same(twoReceived, 1)

  await cleanup()
  t.end()
})

test('can broadcast on a network extension', async t => {
  const { clients, cleanup } = await createMany(3)
  const extensionName = 'test-extension'

  const client1 = clients[0]
  const client2 = clients[1]
  const client3 = clients[2]
  let oneReceived = 0
  let twoReceived = 0

  const sharedKey = hypercoreCrypto.randomBytes(32)

  client1.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello world')
      oneReceived++
    }
  })

  client2.network.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello world')
      twoReceived++
    }
  })

  const ext3 = client3.network.registerExtension(extensionName, {
    encoding: 'utf8'
  })

  await client3.network.configure(sharedKey, { announce: true, lookup: true })
  await client1.network.configure(sharedKey, { announce: false, lookup: true })
  await client2.network.configure(sharedKey, { announce: false, lookup: true })

  await delay(100)

  ext3.broadcast('hello world')

  await delay(100)

  t.same(oneReceived, 1)
  t.same(twoReceived, 1)

  await cleanup()
  t.end()
})

test('can send on a hypercore extension', async t => {
  const { clients, cleanup } = await createMany(3)
  const extensionName = 'test-extension'

  const client1 = clients[0]
  const client2 = clients[1]
  const client3 = clients[2]
  let oneReceived = 0
  let twoReceived = 0

  const core1 = client1.corestore().get()
  await core1.ready()

  const core2 = client2.corestore().get(core1.key)
  const core3 = client3.corestore().get(core1.key)
  await core2.ready()
  await core3.ready()

  const ext1 = core1.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-0')
      oneReceived++
    }
  })

  core2.registerExtension(extensionName, {
    encoding: 'utf8',
    onmessage: (message, peer) => {
      t.true(peer.remotePublicKey.equals(client3.network.keyPair.publicKey))
      t.same(message, 'hello-1')
      twoReceived++
    }
  })

  const ext3 = core3.registerExtension(extensionName, {
    encoding: 'utf8'
  })

  await client3.network.configure(core1.discoveryKey, { announce: true, lookup: true })
  await client1.network.configure(core2.discoveryKey, { announce: false, lookup: true })
  await client2.network.configure(core3.discoveryKey, { announce: false, lookup: true })

  await delay(100)

  for (let i = 0; i < core3.peers.length; i++) {
    ext3.send('hello-' + i, core3.peers[i])
  }

  await delay(100)

  // Destroy the first extension and make sure it doesn't trigger onmessage again.
  ext1.destroy()
  ext3.send('another world', client3.network.peers[0])

  await delay(100)

  t.same(oneReceived, 1)
  t.same(twoReceived, 1)

  await cleanup()
  t.end()
})

test('can read a live stream', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const corestore1 = client1.corestore()
  const corestore2 = client2.corestore()

  const core1 = corestore1.get()
  await core1.ready()
  await core1.append(Buffer.from('zero', 'utf8'))
  await core1.append(Buffer.from('one', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  const core2 = corestore2.get(core1.key, { valueEncoding: 'utf8' })
  await core2.ready()
  await client2.network.configure(core2.discoveryKey, { announce: false, lookup: true })

  const rs = core2.createReadStream({ live: true })
  const blocks = []
  rs.on('data', block => {
    blocks.push(block)
  })

  await delay(100)
  t.deepEqual(blocks, ['zero', 'one'])

  await core1.append(Buffer.from('two'))
  await core1.append(Buffer.from('three'))
  await delay(100)
  t.deepEqual(blocks, ['zero', 'one', 'two', 'three'])

  rs.destroy()
  await cleanup()
  t.end()
})

test('can watch downloads, uploads, and appends', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const corestore1 = client1.corestore()
  const corestore2 = client2.corestore()

  const core1 = corestore1.get()
  await core1.ready()
  await core1.append(Buffer.from('zero', 'utf8'))
  await core1.append(Buffer.from('one', 'utf8'))
  await core1.append(Buffer.from('two', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  const core2 = corestore2.get(core1.key)
  await core2.ready()

  let uploads = 0
  let uploadBytes = 0
  let downloads = 0
  let downloadBytes = 0
  let appends = 0
  core1.on('upload', (seq, data) => { uploads++; uploadBytes += data.byteLength })
  core2.on('download', (seq, data) => { downloads++; downloadBytes += data.byteLength })
  core2.on('append', () => (appends++))

  await client2.network.configure(core1.discoveryKey, { announce: false, lookup: true })

  let downloadPromise = watchDownloadPromise(core2, 2)
  let block = await core2.get(2)
  t.same(block.toString('utf8'), 'two')
  await downloadPromise

  downloadPromise = watchDownloadPromise(core2, 0)
  block = await core2.get(0)
  t.same(block.toString('utf8'), 'zero')
  await downloadPromise

  t.equal(uploads, 2, 'upload count correct')
  t.equal(uploadBytes, 7, 'upload bytes correct')
  t.equal(downloads, 2, 'download count correct')
  t.equal(downloadBytes, 7, 'download bytes correct')
  t.equal(appends, 1, 'append count correct')

  await core1.append(Buffer.from('three', 'utf8'))
  await core1.append(Buffer.from('four', 'utf8'))
  await core2.update({})
  t.equal(appends, 2, 'append counter after update correct')

  downloadPromise = watchDownloadPromise(core2, 4)
  await core2.download(4)
  await downloadPromise
  t.equal(uploadBytes, 11, 'upload bytes after download correct')
  t.equal(uploads, 3, 'upload counter after download correct')
  t.equal(downloadBytes, 11, 'download bytes after download correct')
  t.equal(downloads, 3, 'download counter after download correct')

  await cleanup()
  t.end()
})

test('download all', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const corestore1 = client1.corestore()
  const corestore2 = client2.corestore()

  const core1 = corestore1.get()
  await core1.ready()
  await core1.append(Buffer.from('zero', 'utf8'))
  await core1.append(Buffer.from('one', 'utf8'))
  await core1.append(Buffer.from('two', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  const core2 = corestore2.get(core1.key)
  await core2.ready()

  let downloads = 0
  const p = new Promise((resolve) => {
    core2.on('download', () => {
      downloads++
      if (downloads === 3) resolve()
    })
  })

  await client2.network.configure(core1.discoveryKey, { announce: false, lookup: true })

  core2.download() // download all

  await p
  t.same(downloads, 3, '3 downloads')
  await cleanup()
  t.end()
})

test('can swarm with the replicate function', async t => {
  const { clients, cleanup } = await createMany(2)

  const client1 = clients[0]
  const client2 = clients[1]
  const corestore1 = client1.corestore()
  const corestore2 = client2.corestore()

  const core1 = corestore1.get()
  await client1.replicate(core1)
  await core1.append(Buffer.from('hello world', 'utf8'))

  const core2 = corestore2.get(core1.key)
  await client2.replicate(core2)
  const block = await core2.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

function watchDownloadPromise (core, expectedSeq) {
  return new Promise((resolve, reject) => {
    core.once('download', seq => {
      if (seq === expectedSeq) resolve()
      else reject(new Error('Expected ' + expectedSeq + ', found ' + seq))
    })
  })
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
