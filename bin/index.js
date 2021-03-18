#!/usr/bin/env node
const p = require('path')
const os = require('os')
const fs = require('fs').promises
const repl = require('repl')
const minimist = require('minimist')

const { Server, Client } = require('../')
const { migrate: migrateFromDaemon, isMigrated } = require('@hyperspace/migration-tool')

// TODO: Default paths are duplicated here because we need to do the async migration check.
const HYPERSPACE_STORAGE_DIR = p.join(os.homedir(), '.hyperspace', 'storage')
const HYPERDRIVE_STORAGE_DIR = p.join(os.homedir(), '.hyperdrive', 'storage', 'cores')

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
    bootstrap: 'b',
    'network-port': 'n'
  }
})

const version = `hyperspace/${require('../package.json').version} ${process.platform}-${process.arch} node-${process.version}`

const help = `Hypercore, batteries included.
${version}

Usage: hyperspace [options]

  --host,         -h  Set unix socket name
  --port          -p  Set the port (will use TCP)
  --storage,      -s  Overwrite storage folder
  --bootstrap,    -b  Overwrite DHT bootstrap servers
  --network-port, -n  Set the network port to use
  --memory-only       Run all storage in memory
  --no-announce       Disable all network annoucnes
  --repl              Run a debug repl
  --no-migrate        Disable the Hyperdrive Daemon migration
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
    if (!(await isMigrated({ noMove: true }))) {
      console.log('Migrating from Hyperdrive daemon...')
      // TODO: For Beaker compat, do not move existing cores into ~/.hyperspace for now.
      await migrateFromDaemon({ noMove: true })
      console.log('Migration finished.')
    }
  }

  // For now, the storage path is determined as follows:
  // If ~/.hyperdrive/storage/cores exists, use that (from an old hyperdrive daemon installation)
  // Else, use ~/.hyperspace/storage
  const storage = argv.storage ? argv.storage : await getStoragePath()

  const s = new Server({
    host: argv.host,
    port: argv.port,
    storage,
    network: { bootstrap: argv.bootstrap ? [].concat(argv.bootstrap) : undefined, preferredPort: argv.n || undefined, ephemeral: true },
    noAnnounce: !argv.announce,
    noMigrate: !argv.migrate
  })
  global.hyperspace = s

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

async function getStoragePath () {
  try {
    // If this dir exists, use it.
    await fs.stat(HYPERDRIVE_STORAGE_DIR)
    return HYPERDRIVE_STORAGE_DIR
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return HYPERSPACE_STORAGE_DIR
  }
}

function onerror (err) {
  console.error(err.stack)
  process.exit(1)
}
