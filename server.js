const path = require('path')
const os = require('os')

const Corestore = require('corestore')
const Networker = require('@corestore/networker')
const HypercoreCache = require('hypercore-cache')
const hypercoreStorage = require('hypercore-default-storage')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const HRPC = require('@hyperspace/rpc')
const getNetworkOptions = require('@hyperspace/rpc/socket')

const HyperspaceDb = require('./lib/db')
const SessionState = require('./lib/session-state')
const CorestoreSession = require('./lib/sessions/corestore')
const HypercoreSession = require('./lib/sessions/hypercore')
const NetworkSession = require('./lib/sessions/network')
const startTrieExtension = require('./extensions/trie')

const TOTAL_CACHE_SIZE = 1024 * 1024 * 512
const CACHE_RATIO = 0.5
const TREE_CACHE_SIZE = TOTAL_CACHE_SIZE * CACHE_RATIO
const DATA_CACHE_SIZE = TOTAL_CACHE_SIZE * (1 - CACHE_RATIO)

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.hyperspace', 'storage')
const MAX_PEERS = 256
const SWARM_PORT = 49737

module.exports = class Hyperspace extends Nanoresource {
  constructor (opts = {}) {
    super()

    var storage = opts.storage || DEFAULT_STORAGE_DIR
    if (typeof storage === 'string') {
      const storagePath = storage
      storage = p => hypercoreStorage(path.join(storagePath, p))
    }

    const corestoreOpts = {
      storage,
      cacheSize: opts.cacheSize,
      sparse: opts.sparse !== false,
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
    startTrieExtension(this.corestore)

    this.server = HRPC.createServer(opts.server, this._onConnection.bind(this))
    this.db = new HyperspaceDb(this.corestore)
    this.networker = null

    this.noAnnounce = !!opts.noAnnounce

    this._networkOpts = {
      announceLocalNetwork: true,
      preferredPort: SWARM_PORT,
      maxPeers: MAX_PEERS,
      ...opts.network
    }
    this._socketOpts = getNetworkOptions(opts)
    this._networkState = new Map()
  }

  // Nanoresource Methods

  async _open () {
    await this.corestore.ready()
    await this.db.open()
    this.networker = new Networker(this.corestore, this._networkOpts)
    await this.networker.listen()
    this._registerCoreTimeouts()
    await this._rejoin()

    await this.server.listen(this._socketOpts)
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
      const joinProm = this.networker.configure(config.discoveryKey, {
        announce: config.announce,
        lookup: config.lookup,
        // remember/discoveryKey are passed so that they will be saved in the networker's internal configurations list.
        remember: true,
        discoveryKey: config.discoveryKey
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

      if (!this.networker.swarm || this.networker.swarm.destroyed) return
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

  _onConnection (client) {
    const sessionState = new SessionState(this.corestore)

    this.emit('client-open', client)

    client.on('close', () => {
      sessionState.deleteAll()
      this.emit('client-close', client)
    })

    client.hyperspace.onRequest(this)
    client.corestore.onRequest(new CorestoreSession(client, sessionState, this.corestore))
    client.hypercore.onRequest(new HypercoreSession(client, sessionState))
    client.network.onRequest(new NetworkSession(client, sessionState, this.corestore, this.networker, this.db, this._networkState, {
      noAnnounce: this.noAnnounce
    }))
  }

  // Top-level RPC Methods

  status () {
    const swarm = this.networker && this.networker.swarm
    const remoteAddress = swarm && swarm.remoteAddress()
    const holepunchable = swarm && swarm.holepunchable()
    return {
      version: require('./package.json').version,
      apiVersion: require('@hyperspace/rpc/package.json').version,
      holepunchable: holepunchable,
      remoteAddress: remoteAddress ? remoteAddress.host + ':' + remoteAddress.port : ''
    }
  }

  stop () {
    return this.close()
  }
}

function callAllInSet (set) {
  for (const cb of set) {
    cb()
  }
  set.clear()
}
