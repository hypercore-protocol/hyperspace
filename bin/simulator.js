#!/usr/bin/env node
const p = require('path')
const { spawn } = require('child_process')
const minimist = require('minimist')
const ram = require('random-access-memory')

const { Server } = require('../')

const argv = minimist(process.argv.slice(2), {
  '--': true
})
const version = `hyperspace/${require('../package.json').version} ${process.platform}-${process.arch} node-${process.version}`
const help = `Hypercore, batteries included.
${version}

Usage: hyperspace-simulator <script.js> -- [script-args]
  Run the test script using an live, in-memory Hyperspace instance.
`

if (argv.help) {
  console.error(help)
  process.exit(0)
}
main().catch(onerror)

async function main () {
  if (!argv._.length) return console.error(help)
  const scriptPath = p.resolve(argv._[0].toString())
  const simulatorId = `hyperspace-simulator-${process.pid}`
  process.env.HYPERSPACE_SOCKET = simulatorId

  const server = new Server({
    host: simulatorId,
    storage: ram,
    noMigrate: true
  })
  await server.open()

  process.once('SIGINT', close)
  process.once('SIGTERM', close)

  const childArgs = argv['--'] || []
  const child = spawn(process.execPath, [scriptPath, ...childArgs], {
    stdio: 'inherit'
  })
  child.on('close', close)

  function close () {
    console.log('Shutting down simulator...')
    server.close().catch(onerror)
  }
}

function onerror (err) {
  console.error(err.stack)
  process.exit(1)
}
