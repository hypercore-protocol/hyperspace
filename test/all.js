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
  const { server, client, cleanup } = await create()

  const core = client.get()
  await core.ready()

  await core.append(Buffer.from('hello world', 'utf8'))
  const block = await core.get(0)
  t.same(block.toString('utf8'), 'hello world')

  await cleanup()
  t.end()
})

test('length/byteLength update correctly on append', async t => {
  const { server, client, cleanup } = await create()

  const core = client.get()
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

test('update with current length returns', async t => {
  const { server, client, cleanup } = await create()

  const core = client.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await core.append(buf)
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

test('seek works correctly', async t => {
  const { server, client, cleanup } = await create()

  const core = client.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  await core.append([buf, buf])

  {
    let { seq, blockOffset } = await core.seek(0)
    t.same(seq, 0)
    t.same(blockOffset, 0)
  }

  {
    let { seq, blockOffset } = await core.seek(5)
    t.same(seq, 0)
    t.same(blockOffset, 5)
  }

  {
    let { seq, blockOffset } = await core.seek(15)
    t.same(seq, 1)
    t.same(blockOffset, 4)
  }

  await cleanup()
  t.end()
})

test('has works correctly', async t => {
  const { server, client, cleanup } = await create()

  const core = client.get()
  await core.ready()

  const buf = Buffer.from('hello world', 'utf8')
  let seq = await core.append(buf)

  const doesHave = await core.has(0)
  const doesNotHave = await core.has(1)
  t.true(doesHave)
  t.false(doesNotHave)

  await cleanup()
  t.end()
})

async function create () {
  const server = new HyperspaceServer()
  await server.ready()

  const client = new HyperspaceClient()
  await client.ready()

  const cleanup = () => Promise.all([
    server.close(),
    client.close()
  ])

  return { server, client, cleanup }
}
