#!/usr/bin/env node
const p = require('path')
const os = require('os')
const fs = require('fs').promises
const repl = require('repl')
const { spawn } = require('child_process')
const minimist = require('minimist')
const ram = require('random-access-memory')

const { Server, Client } = require('./')
const { migrate: migrateFromDaemon, isMigrated } = require('@hyperspace/migration-tool')
const getNetworkOptions = require('@hyperspace/rpc/socket')

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
    bootstrap: 'b'
  }
})

const version = `hyperspace/${require('./package.json').version} ${process.platform}-${process.arch} node-${process.version}`

const help = `Hypercore, batteries included.
${version}

Usage: hyperspace [command] [options]
  Commands:
    simulator <script.js>  Run script.js using an in-memory Hyperspace instance
  
  Flags:
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
  if (argv._[0] === 'simulator') {
    return simulator()
  }

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

  const s = createServer(storage, argv)
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

function createServer (storage, opts) {
  return new Server({
    host: opts.host,
    port: opts.port,
    storage,
    network: opts.bootstrap ? { bootstrap: [].concat(opts.bootstrap) } : null,
    noAnnounce: !opts.announce,
    noMigrate: !opts.migrate
  })
}

async function simulator () {
  if (argv._.length === 1) throw new Error('Must provide a script for the simulator to run.')
  const scriptPath = p.resolve(argv._[1])
  const simulatorId = `hyperspace-simulator-${process.pid}`
  process.env.HYPERSPACE_SOCKET = simulatorId

  const server = createServer(ram, {
    ...argv,
    host: simulatorId
  })
  await server.open()

  process.once('SIGINT', close)
  process.once('SIGTERM', close)

  const child = spawn(process.execPath, [scriptPath], {
    env: {
      HYPERSPACE_SOCKET: simulatorId
    },
    stdio: 'inherit'
  })
  child.on('close', close)

  async function close () {
    console.log('Shutting down simulator...')
    server.close().catch(onerror)
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
