// All tests have been taken directly from Hypertrie.
// (with modifications to inject RemoteHypercores)

const tape = require('tape')
const ram = require('random-access-memory')
const byteStream = require('hypercore-byte-stream')
const RemoteCorestore = require('../client')
const HyperspaceServer = require('../server')

let server = null
let store = null
let cleanup = null

function createLocal (numRecords, recordSize, cb) {
  const core = store.get()

  const records = []
  for (let i = 0; i < numRecords; i++) {
    const record = Buffer.allocUnsafe(recordSize).fill(Math.floor(Math.random() * 10))
    records.push(record)
  }

  core.append(records, err => {
    if (err) return cb(err)
    const stream = byteStream()
    return cb(null, core, core, stream, records)
  })
}

require('hypercore-byte-stream/test/helpers/create').createLocal = createLocal

tape('start', async function (t) {
  server = new HyperspaceServer({ storage: ram })
  await server.ready()

  store = new RemoteCorestore()
  await store.ready()

  cleanup = () => Promise.all([
    server.close(),
    store.close()
  ])

  t.end()
})

require('hypercore-byte-stream/test/basic')

tape('end', function (t) {
  server.close()
  store.close()
  t.end()
})
