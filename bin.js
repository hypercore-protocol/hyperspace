#!/usr/bin/env node

const { Server } = require('./')
const minimist = require('minimist')
const argv = minimist(process.argv.slice(2), {
  string: ['host', 'storage', 'bootstrap'],
  boolean: ['memory-only', 'no-announce'],
  alias: {
    host: 'h',
    storage: 's',
    bootstrap: 'b'
  }
})

main().catch(onerror)

async function main () {
  const s = new Server({
    host: argv.host,
    storage: argv.storage,
    network: argv.bootstrap ? { bootstrap: [].concat(argv.bootstrap) } : null,
    memoryOnly: argv['memory-only'],
    noAnnounce: argv['no-announce']
  })

  s.on('client-open', () => {
    console.log('client opened')
  })

  s.on('client-close', () => {
    console.log('client closed')
  })

  process.once('SIGINT', close)
  process.once('SIGTERM', close)

  await s.open()

  function close () {
    s.close().catch(onerror)
  }
}

function onerror (err) {
  console.error(err.stack)
  process.exit(1)
}
