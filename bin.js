#!/usr/bin/env node

const repl = require('repl')
const { Server, Client } = require('./')
const minimist = require('minimist')
const { migrate: migrateFromDaemon, isMigrated } = require('@hyperspace/migration-tool')

const argv = minimist(process.argv.slice(2), {
  string: ['host', 'storage', 'bootstrap'],
  boolean: ['memory-only', 'announce', 'migrate', 'repl'],
  default: {
    announce: true,
    migrate: true
  },
  alias: {
    host: 'h',
    storage: 's',
    bootstrap: 'b'
  }
})

const version = `hyperspace/${require('./package.json').version} ${process.platform}-${process.arch} node-${process.version}`

const help = `Hypercore, batteries included.
${version}

Usage: hyperspace [options]

  --host,      -h  Set unix socket name
  --port       -p  Set the port (will use TCP)
  --storage,   -s  Overwrite storage folder
  --bootstrap, -b  Overwrite DHT bootstrap servers
  --memory-only    Run all storage in memory
  --no-announce    Disable all network annoucnes
  --repl           Run a debug repl
  --no-migrate     Disable the Hyperdrive Daemon migration
`

if (argv.help) {
  console.error(help)
  process.exit(0)
}

main().catch(onerror)

async function main () {
  console.log('Running ' + version)

  // Note: This will be removed in future releases of Hyperspace.
  // If the hyperdrive-daemon -> hyperspace migration has already completed, this is a no-op.
  if (argv.migrate) {
    if (!(await isMigrated())) {
      console.log('Migrating from Hyperdrive daemon...')
      await migrateFromDaemon()
      console.log('Migration finished.')
    }
  }

  const s = new Server({
    host: argv.host,
    port: argv.port,
    storage: argv.storage,
    network: argv.bootstrap ? { bootstrap: [].concat(argv.bootstrap) } : null,
    memoryOnly: argv['memory-only'],
    noAnnounce: !argv.announce,
    noMigrate: !argv.migrate
  })

  if (!argv.repl) {
    s.on('client-open', () => {
      console.log('Remote client opened')
    })

    s.on('client-close', () => {
      console.log('Remote client closed')
    })
  } else {
    const r = repl.start({
      useGlobal: true
    })
    r.context.server = s
  }

  process.once('SIGINT', close)
  process.once('SIGTERM', close)

  try {
    await s.open()
  } catch (err) {
    const c = new Client()
    let status

    try {
      status = await c.status()
    } catch (_) {}

    if (status) {
      console.log('Server is already running with the following status')
      console.log()
      console.log('API Version   : ' + status.apiVersion)
      console.log('Holepunchable : ' + status.holepunchable)
      console.log('Remote address: ' + status.remoteAddress)
      console.log()
      process.exit(1)
    } else {
      throw err
    }
  }

  const socketOpts = s._socketOpts
  if (socketOpts.port) {
    console.log(`Listening on ${socketOpts.host || 'localhost'}:${socketOpts.port}`)
  } else {
    console.log(`Listening on ${socketOpts}`)
  }

  function close () {
    console.log('Shutting down...')
    s.close().catch(onerror)
  }
}

function onerror (err) {
  console.error(err.stack)
  process.exit(1)
}
