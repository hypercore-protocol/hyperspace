// All tests have been taken directly from Hypertrie.
// (with modifications to inject RemoteHypercores)

const tape = require('tape')
const ram = require('random-access-memory')
const byteStream = require('hypercore-byte-stream')
const HyperspaceClient = require('../client')
const HyperspaceServer = require('../server')

let server = null
let client = null
let cleanup = null

function createLocal (numRecords, recordSize, cb) {
  const corestore = client.corestore()
  const core = corestore.get()

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

  client = new HyperspaceClient()
  await client.ready()

  cleanup = () => Promise.all([
    server.close(),
    client.close()
  ])

  t.end()
})

require('hypercore-byte-stream/test/basic')

tape('end', async function (t) {
  await cleanup()
  t.end()
})
