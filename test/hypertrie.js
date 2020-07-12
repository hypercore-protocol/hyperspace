// All tests have been taken directly from Hypertrie.
// (with modifications to inject RemoteHypercores)

const tape = require('tape')
const hypertrie = require('hypertrie')
const ram = require('random-access-memory')

const HyperspaceClient = require('../client')
const HyperspaceServer = require('../server')

let server = null
let client = null
let cleanup = null

function create (key, opts) {
  const corestore = client.corestore()
  const feed = corestore.get(key)
  return hypertrie(null, null, {
    valueEncoding: 'json',
    ...opts,
    extension: false,
    feed
  })
}

require('hypertrie/test/helpers/create').create = create

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

require('hypertrie/test/basic')
require('hypertrie/test/diff')
require('hypertrie/test/hidden')
require('hypertrie/test/iterator')
require('hypertrie/test/history')
// require('hypertrie/test/watch')
require('hypertrie/test/closest')
require('hypertrie/test/deletes')

tape('end', async function (t) {
  await cleanup()
  t.end()
})
