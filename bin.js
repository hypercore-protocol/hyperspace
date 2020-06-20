#!/usr/bin/env node

const { Server } = require('./')
const minimist = require('minimist')
const argv = minimist(process.argv.slice(2), {
  alias: {
    host: 'h'
  }
})

main().catch(onerror)

async function main () {
  const s = new Server({
    host: argv.host
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
