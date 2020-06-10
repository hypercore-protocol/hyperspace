// All tests have been taken directly from Hypertrie.
// (with modifications to inject RemoteHypercores)

const tape = require('tape')
const hypertrie = require('hypertrie')
const ram = require('random-access-memory')
const Readable = require('stream').Readable

const RemoteCorestore = require('../client')
const HyperspaceServer = require('../server')

let server = null
let store = null
let cleanup = null

function create (key, opts) {
  const feed = store.get(key)
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

  store = new RemoteCorestore()
  await store.ready()

  cleanup = () => Promise.all([
    server.close(),
    store.close()
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

tape('end', function (t) {
  server.close()
  store.close()
  t.end()
})

