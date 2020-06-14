const Corestore = require('corestore')
const Networker = require('corestore-swarm-networking')
const hypertrie = require('hypertrie')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const HRPC = require('./lib/rpc')
const messages = require('./lib/messages')
const HyperspaceDb = require('./lib/db')
const ReferenceCounter = require('./lib/references')
const SessionState = require('./lib/session-state')
const getSocketName = require('./lib/socket')

const CorestoreSession = require('./lib/sessions/corestore')
const HypercoreSession = require('./lib/sessions/hypercore')
const NetworkSession = require('./lib/sessions/network')

module.exports = class Hyperspace extends Nanoresource {
  constructor (opts = {}) {
    super()
    this.corestore = new Corestore(opts.storage || './storage')
    this.server = HRPC.createServer(this._onConnection.bind(this))
    this.references = new ReferenceCounter()
    this.db = new HyperspaceDb(this.corestore)
    this.networker = null

    this._networkOpts = opts.network || {}
    this._sock = getSocketName(opts.host)
    this._references = new Map()
    this._transientNetworkConfigurations = new Map()

    this._namespacedStore = null
    this._db = null
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
      core.once('peer-add', () => callAllInSet(peerAddSet))

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
    const sessionState = new SessionState(this.references)
    const resources = new Map()

    client.on('close', () => {
      sessionState.deleteAll()
    })

    client.corestore.onRequest(new CorestoreSession(client, sessionState, this.corestore))
    client.hypercore.onRequest(new HypercoreSession(client, sessionState))
    client.network.onRequest(new NetworkSession(client, sessionState, this.networker, this.db, this._transientNetworkConfigurations))
  }
}

function callAllInSet (set) {
  for (const cb of set) {
    cb()
  }
  set.clear()
}

function keyToString (key) {
  if (typeof key === 'string') return key
  return key.toString('hex')
}

function keyFromString (key) {
  if (Buffer.isBuffer(key)) return key
  return Buffer.from(key, 'hex')
}
