const test = require('tape')
const { createMany } = require('./helpers/create')

test('can get a bitfield', async t => {
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
  await core1.append(Buffer.from('three', 'utf8'))
  await client1.network.configure(core1.discoveryKey, { announce: true, lookup: true, flush: true })

  const core2 = corestore2.get(core1.key)
  await core2.ready()

  await client2.network.configure(core2.discoveryKey, { announce: false, lookup: true })

  await core2.get(1)
  await core2.get(2)
  const bitfield = await core2.getBitfield()
  t.equal(bitfield.get(0), false)
  t.equal(bitfield.get(1), true)
  t.equal(bitfield.get(2), true)
  t.equal(bitfield.get(4), false)
  await cleanup()
  t.end()
})
