const test = require('tape')
const hypertrie = require('hypertrie')
const hyperdrive = require('hyperdrive')

const { createOne } = require('./helpers/create')

test('can open a core', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  t.same(core.byteLength, 0)
  t.same(core.length, 0)
  t.same(core.key.length, 32)
  t.same(core.discoveryKey.length, 32)

  await cleanup()
  t.end()
})

test('can get a block', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  await core.append(Buffer.from('hello world', 'utf8'))
  const block = await core.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('length/byteLength update correctly on append', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  let appendedCount = 0
  core.on('append', () => {
    appendedCount++
  })

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await core.append(buf)
  t.same(seq, 0)
  t.same(core.byteLength, buf.length)
  t.same(core.length, 1)

  seq = await core.append([buf, buf])
  t.same(seq, 1)
  t.same(core.byteLength, buf.length * 3)
  t.same(core.length, 3)

  t.same(appendedCount, 2)

  await cleanup()
  t.end()
})

test('downloaded gives the correct result after append', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append([buf, buf, buf])
  const downloaded = await core.downloaded()
  t.same(downloaded, 3)

  await cleanup()
  t.end()
})

test('update with current length returns', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  const seq = await core.append(buf)
  t.same(seq, 0)
  t.same(core.byteLength, buf.length)
  t.same(core.length, 1)

  await core.update(1)
  t.pass('update terminated')

  try {
    await core.update({ ifAvailable: true })
    t.fail('should not get here')
  } catch (err) {
    t.true(err, 'should error with no peers')
  }

  await cleanup()
  t.end()
})

test('appending many large blocks works', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  const NUM_BLOCKS = 200
  const BLOCK_SIZE = 1e5

  const bufs = (new Array(NUM_BLOCKS).fill(0)).map(() => {
    return Buffer.allocUnsafe(BLOCK_SIZE)
  })
  const seq = await core.append(bufs)
  t.same(seq, 0)
  t.same(core.byteLength, NUM_BLOCKS * BLOCK_SIZE)

  await cleanup()
  t.end()
})

test('seek works correctly', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append([buf, buf])

  {
    const { seq, blockOffset } = await core.seek(0)
    t.same(seq, 0)
    t.same(blockOffset, 0)
  }

  {
    const { seq, blockOffset } = await core.seek(5)
    t.same(seq, 0)
    t.same(blockOffset, 5)
  }

  {
    const { seq, blockOffset } = await core.seek(15)
    t.same(seq, 1)
    t.same(blockOffset, 4)
  }

  await cleanup()
  t.end()
})

test('has works correctly', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append(buf)

  const doesHave = await core.has(0)
  const doesNotHave = await core.has(1)
  t.true(doesHave)
  t.false(doesNotHave)

  await core.close()
  await cleanup()
  t.end()
})

test('download works correctly', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append(buf)

  for (let i = 0; i < 3; i++) {
    const prom = core.download({ start: 0, end: 10 })
    await core.undownload(prom)

    try {
      await prom
    } catch (err) {
      t.same(err.message, 'Download was cancelled')
    }
  }

  await core.close()
  await cleanup()
  t.end()
})

test('valueEncodings work', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get({ valueEncoding: 'utf8' })
  await core.ready()

  await core.append('hello world')
  const block = await core.get(0)
  t.same(block, 'hello world')

  await cleanup()
  t.end()
})

test('corestore default get works', async t => {
  const { client, cleanup } = await createOne()

  const ns1 = client.corestore('blah')
  const ns2 = client.corestore('blah2')

  var core = ns1.default()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append(buf)
  await core.close()

  // we have a timing thing here we should fix
  await new Promise(resolve => setTimeout(resolve, 500))
  core = ns1.default()
  await core.ready()

  t.same(core.length, 1)
  t.true(core.writable)

  core = ns2.default()
  await core.ready()
  t.same(core.length, 0)

  await cleanup()
  t.end()
})

test('weak references work', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core1 = corestore.get()
  await core1.ready()

  const core2 = corestore.get(core1.key, { weak: true })
  await core2.ready()

  await core1.append(Buffer.from('hello world', 'utf8'))
  t.same(core2.length, 1)

  const closed = new Promise((resolve) => core2.once('close', resolve))
  await core1.close()

  await closed
  t.pass('closed')
  await cleanup()
  t.end()
})

test('corestore feed event fires', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const emittedFeeds = []
  const emittedProm = new Promise(resolve => {
    corestore.on('feed', async feed => {
      t.same(feed._id, undefined)
      emittedFeeds.push(feed)
      if (emittedFeeds.length === 3) {
        await onAllEmitted()
        return resolve()
      }
    })
  })

  const core1 = corestore.get()
  await core1.ready()
  const core2 = corestore.get()
  await core2.ready()
  const core3 = corestore.get()
  await core3.ready()
  await emittedProm

  async function onAllEmitted () {
    for (const feed of emittedFeeds) {
      await feed.ready()
    }
    t.true(emittedFeeds[0].key.equals(core1.key))
    t.true(emittedFeeds[1].key.equals(core2.key))
    t.true(emittedFeeds[2].key.equals(core3.key))
    await cleanup()
    t.end()
  }
})

test('can lock and release', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core1 = corestore.get()
  await core1.ready()

  const release = await core1.lock()

  let unlocked = false
  const other = core1.lock()

  t.pass('locked')
  other.then(() => t.ok(unlocked))
  await new Promise(resolve => setTimeout(resolve, 500))

  release()
  unlocked = true
  await other
  await cleanup()
  t.end()
})

test('cancel a get', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()

  const prom1 = core.get(42, { ifAvailable: false })
  const prom2 = core.get(43, { ifAvailable: false })

  let cancel1 = false
  let cancel2 = false

  prom1.catch((err) => {
    cancel1 = true
    t.notOk(cancel2, 'cancelled promise 1 first')
    t.ok(err, 'got error')
    core.cancel(prom2)
  })
  prom2.catch((err) => {
    cancel2 = true
    t.ok(cancel1, 'cancelled promise 1 first')
    t.ok(err, 'got error')
  })

  core.cancel(prom1)

  try {
    await prom1
    await prom2
  } catch (_) {}

  await cleanup()
  t.end()
})

test('onwait', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()

  const a = core.get(42, {
    onwait (seq) {
      t.ok('should wait')
      t.same(seq, 42)
      core.cancel(a)
    }
  })

  const b = core.get(43, {
    onwait (seq) {
      t.ok('should wait')
      t.same(seq, 43)
      core.cancel(b)
    }
  })

  try {
    await a
  } catch (_) {}
  try {
    await b
  } catch (_) {}

  await cleanup()
  t.end()
})

test('onwait only on missing blocks', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  await core.append(Buffer.from('hello world', 'utf8'))
  const block = await core.get(0, {
    onwait () {
      t.notOk('should not wait')
    }
  })
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('can run a hypertrie on remote hypercore', async t => {
  const { client, cleanup } = await createOne()

  const corestore = client.corestore()
  const core = corestore.default()
  await core.ready()

  const trie = hypertrie(null, null, {
    feed: core,
    extension: false,
    valueEncoding: 'utf8'
  })
  await new Promise(resolve => {
    trie.ready(err => {
      t.error(err, 'no error')
      trie.put('/hello', 'world', err => {
        t.error(err, 'no error')
        trie.get('/hello', (err, node) => {
          t.error(err, 'no error')
          t.same(node.value, 'world')
          return resolve()
        })
      })
    })
  })

  await cleanup()
  t.end()
})

test('can run a hyperdrive on a remote hypercore', async t => {
  const { client, cleanup } = await createOne()

  const drive = hyperdrive(client.corestore(), null, {
    valueEncoding: 'utf8'
  })
  await new Promise(resolve => {
    drive.ready(err => {
      t.error(err, 'no error')
      drive.writeFile('/hello', 'world', err => {
        t.error(err, 'no error')
        drive.readFile('/hello', { encoding: 'utf8' }, (err, contents) => {
          t.error(err, 'no error')
          t.same(contents, 'world')
          return resolve()
        })
      })
    })
  })

  await cleanup()
  t.end()
})

test('can connect over a tcp socket', async t => {
  const { client, cleanup } = await createOne({
    port: 8199
  })

  const corestore = client.corestore()
  const core = corestore.get()
  await core.ready()

  t.same(core.byteLength, 0)
  t.same(core.length, 0)
  t.same(core.key.length, 32)
  t.same(core.discoveryKey.length, 32)

  await cleanup()
  t.end()
})

test('handles corestore gc correctly', async t => {
  const { client, cleanup } = await createOne({
    cacheSize: 1
  })
  const store1 = client.corestore()
  const store2 = client.corestore()

  const core1 = store1.get()
  await core1.ready()

  const core2 = store2.get()
  const core3 = store2.get(core1.key)
  await core2.ready()
  await core3.ready()

  try {
    await core3.append('hello world')
    t.pass('append did not error')
  } catch (err) {
    t.fail(err)
  }

  await cleanup()
  t.end()
})
