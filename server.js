const Corestore = require('corestore')
const Networker = require('corestore-swarm-networking')
const HypercoreCache = require('hypercore-cache')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const HRPC = require('./lib/rpc')
const HyperspaceDb = require('./lib/db')
const ReferenceCounter = require('./lib/references')
const SessionState = require('./lib/session-state')
const getSocketName = require('./lib/socket')

const CorestoreSession = require('./lib/sessions/corestore')
const HypercoreSession = require('./lib/sessions/hypercore')
const NetworkSession = require('./lib/sessions/network')

const TOTAL_CACHE_SIZE = 1024 * 1024 * 512
const CACHE_RATIO = 0.5
const TREE_CACHE_SIZE = TOTAL_CACHE_SIZE * CACHE_RATIO
const DATA_CACHE_SIZE = TOTAL_CACHE_SIZE * (1 - CACHE_RATIO)

const MAX_PEERS = 256
const SWARM_PORT = 49737

class Plugin {
  constructor (plugin) {
    this.plugin = plugin
    this.name = plugin.name || plugin.constructor.NAME
    this.autoStart = plugin.autoStart || plugin.constructor.AUTOSTART
    this.pending = null
    this.started = null
  }

  async _wait () {
    try {
      await this.pending
    } catch (_) {}
  }

  async status () {
    await this._wait()
    return { running: !!this.started }
  }

  async start (val) {
    await this._wait()
    if (!this.started) this.pending = this.started = this.plugin.start(val)
    return { value: await this.started }
  }

  async stop () {
    await this._wait()
    if (this.started) this.pending = this.plugin.stop()
    this.started = null
    return this.pending
  }
}

module.exports = class Hyperspace extends Nanoresource {
  constructor (opts = {}) {
    super()

    const corestoreOpts = {
      storage: opts.storage || './storage',
      sparse: true,
      // Collect networking statistics.
      stats: true,
      cache: {
        data: new HypercoreCache({
          maxByteSize: DATA_CACHE_SIZE,
          estimateSize: val => val.length
        }),
        tree: new HypercoreCache({
          maxByteSize: TREE_CACHE_SIZE,
          estimateSize: val => 40
        })
      },
      ifAvailable: true
    }
    this.corestore = new Corestore(corestoreOpts.storage, corestoreOpts)

    this.server = HRPC.createServer(this._onConnection.bind(this))
    this.references = new ReferenceCounter()
    this.db = new HyperspaceDb(this.corestore)
    this.networker = null

    this.noAnnounce = !!opts.noAnnounce
    this._networkOpts = opts.network || {
      announceLocalNetwork: true,
      preferredPort: SWARM_PORT,
      maxPeers: MAX_PEERS,
      ...opts.network
    }
    this._sock = getSocketName(opts.host)
    this._references = new Map()
    this._transientNetworkConfigurations = new Map()
    this._pluginsMap = new Map()

    for (const plugin of opts.plugins) {
      const p = new Plugin(plugin)
      if (!p.name) throw new Error('plugin.name is required')
      this._pluginsMap.set(p.name, p)
    }
  }

  // Nanoresource Methods

  async _open () {
    await this.corestore.ready()
    await this.db.open()
    this.networker = new Networker(this.corestore, this._networkOpts)
    await this.networker.listen()
    this._registerCoreTimeouts()
    await this._rejoin()
    await this.server.listen(this._sock)
  }

  async _close () {
    await this.server.close()
    await this.networker.close()
    await this.db.close()
    await new Promise((resolve, reject) => {
      this.corestore.close(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  // Public Methods

  ready () {
    return this.open()
  }

  // Private Methods

  async _rejoin () {
    if (this.noAnnounce) return
    const networkConfigurations = await this.db.listNetworkConfigurations()
    for (const config of networkConfigurations) {
      if (!config.announce) continue
      const joinProm = this.networker.join(config.discoveryKey, {
        announce: config.announce,
        lookup: config.lookup
      })
      joinProm.catch(err => this.emit('swarm-error', err))
    }
  }

  /**
   * This is where we define our main heuristic for allowing hypercore gets/updates to proceed.
   */
  _registerCoreTimeouts () {
    const flushSets = new Map()

    this.networker.on('flushed', dkey => {
      const keyString = dkey.toString('hex')
      if (!flushSets.has(keyString)) return
      const { flushSet, peerAddSet } = flushSets.get(keyString)
      callAllInSet(flushSet)
      callAllInSet(peerAddSet)
    })

    this.corestore.on('feed', core => {
      const discoveryKey = core.discoveryKey
      const peerAddSet = new Set()
      const flushSet = new Set()
      var globalFlushed = false

      if (!this.networker.swarm) return
      this.networker.swarm.flush(() => {
        if (this.networker.joined(discoveryKey)) return
        globalFlushed = true
        callAllInSet(flushSet)
        callAllInSet(peerAddSet)
      })

      flushSets.set(discoveryKey.toString('hex'), { flushSet, peerAddSet })
      core.once('peer-add', () => {
        callAllInSet(peerAddSet)
      })

      const timeouts = {
        get: (cb) => {
          if (this.networker.joined(discoveryKey)) {
            if (this.networker.flushed(discoveryKey)) return cb()
            return flushSet.add(cb)
          }
          if (globalFlushed) return cb()
          return flushSet.add(cb)
        },
        update: (cb) => {
          const oldCb = cb
          cb = (...args) => {
            oldCb(...args)
          }
          if (core.peers.length) return cb()
          if (this.networker.joined(discoveryKey)) {
            if (this.networker.flushed(discoveryKey) && !core.peers.length) return cb()
            return peerAddSet.add(cb)
          }
          if (globalFlushed) return cb()
          return peerAddSet.add(cb)
        }
      }
      core.timeouts = timeouts
    })
  }

  _getPlugin (name) {
    const p = this._pluginsMap.get(name)
    if (!p) throw new Error('Unknown plugin: ' + name)
    return p
  }

  _onConnection (client) {
    const sessionState = new SessionState(this.references)

    client.on('close', () => {
      sessionState.deleteAll()
    })

    client.plugins.onRequest(this, {
      start ({ name, value }) {
        return this._getPlugin(name).start(value)
      },
      stop ({ name }) {
        return this._getPlugin(name).stop()
      },
      status ({ name }) {
        return this._getPlugin(name).status()
      }
    })
    client.corestore.onRequest(new CorestoreSession(client, sessionState, this.corestore))
    client.hypercore.onRequest(new HypercoreSession(client, sessionState))
    client.network.onRequest(new NetworkSession(client, sessionState, this.corestore, this.networker, this.db, this._transientNetworkConfigurations, {
      noAnnounce: this.noAnnounce
    }))
  }
}

function callAllInSet (set) {
  for (const cb of set) {
    cb()
  }
  set.clear()
}
