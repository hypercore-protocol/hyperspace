const Corestore = require('corestore')
const Networker = require('corestore-swarm-networking')
const hypertrie = require('hypertrie')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const HRPC = require('./lib/rpc')
const messages = require('./lib/messages')

const SOCK = '/tmp/hyperspace.sock'
const INTERNAL_NAMESPACE = '@hyperspace:internal'

module.exports = class Hyperspace extends Nanoresource {
  constructor (opts = {}) {
    super()
    this.corestore = new Corestore(opts.storage || './storage')
    this.server = HRPC.createServer(this._onConnection.bind(this))
    this.db = null
    this.networker = null

    this._networkOpts = opts.network || {}
    this._sock = opts.host || SOCK
    this._references = new Map()
    this._transientNetworkConfigurations = new Map()

    this._namespacedStore = null
    this._db = null
  }

  // Nanoresource Methods

  async _open () {
    await this.corestore.ready()
    this.networker = new Networker(this.corestore, this._networkOpts)
    await this._loadDatabase()
    await this.networker.listen()
    this._registerCoreTimeouts()
    await this.server.listen(this._sock)
  }

  async _close () {
    await this.server.close()
    await this.networker.close()
    await this.corestore.close()
  }

  // Private Methods

  async _loadDatabase () {
    this._namespacedStore = this.corestore.namespace(INTERNAL_NAMESPACE)
    await this._namespacedStore.ready()
    const dbFeed = this._namespacedStore.default()
    this._db = hypertrie(null, null, { feed: dbFeed, valueEncoding: messages.NetworkConfiguration })
    await new Promise((resolve, reject) => {
      this._db.ready(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
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

  _incrementCore (core) {
    let oldCount = this._references.get(core) || 0
    this._references.set(core, oldCount + 1)
  }

  _decrementCore (core) {
    let currentCount = this._references.get(core)
    this._references.set(core, currentCount - 1)
    if (currentCount - 1) return Promise.resolve()
    this._references.delete(core)
    return new Promise((resolve, reject) => {
      core.close(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  _onConnection (client) {
    const sessions = new Map()
    const resources = new Map()
    const unlistensBySession = new Map()

    client.on('close', () => {
      for (const core of sessions.values()) {
        this._decrementCore(core).catch(err => {
          this.emit('error', err)
        })
      }
      for (const unlistens of unlistensBySession.values()) {
        for (const unlisten of unlistens) unlisten()
      }
    })
    client.onRequest(this, {

      // Corestore Methods

      async open ({ id, key, name, opts }) {
        let core = sessions.get(id)
        if (core) throw new Error('Session already in use.')

        core = this.corestore.get({ key, _name: name, default: !!name, ...opts })
        sessions.set(id, core)
        this._incrementCore(core)

        // TODO: Delete session if ready fails.
        await new Promise((resolve, reject) => {
          core.ready(err => {
            if (err) return reject(err)
            return resolve()
          })
        })

        const appendListener = () => {
          client.onAppendNoReply({
            id,
            length: core.length,
            byteLength: core.byteLength
          })
        }
        core.on('append', appendListener)
        let unlistens = unlistensBySession.get(id)
        if (!unlistens) {
          unlistens = []
          unlistensBySession.set(id, unlistens)
        }
        unlistens.push(() => core.removeListener('append', appendListener))

        return {
          key: core.key,
          length: core.length,
          byteLength: core.byteLength,
          writable: core.writable
        }
      },

      // Hypercore Methods

      async close ({ id }) {
        const core = getCore(sessions, id)
        let unlistens = unlistensBySession.get(id)
        if (unlistens) {
          for (const unlisten of unlistens) unlisten()
        }
        unlistensBySession.delete(id)
        sessions.delete(id)
        await this._decrementCore(core)
      },

      async get ({ id, seq, wait, ifAvailable }) {
        const core = getCore(sessions, id)
        return this._rpcGet(core, seq, { ifAvailable, wait })
      },

      async append ({ id, blocks }) {
        const core = getCore(sessions, id)
        return this._rpcAppend(core, blocks)
      },

      async update ({ id, ifAvailable, minLength, hash }) {
        const core = getCore(sessions, id)
        return this._rpcUpdate(core, { ifAvailable, minLength, hash })
      },

      async seek ({ id, byteOffset, start, end, wait, ifAvailable }) {
        const core = getCore(sessions, id)
        return this._rpcSeek(core, byteOffset, { start, end, wait, ifAvailable })
      },

      async has ({ id, seq }) {
        const core = getCore(sessions, id)
        return this._rpcHas(core, seq)
      },

      async download ({ id, resourceId, start, end, blocks, linear }) {
        const core = getCore(sessions, id)
        return this._rpcDownload(core, resources, resourceId, { start, end, blocks: blocks.length ? blocks : null, linear})
      },

      async undownload ({ id, resourceId }) {
        const core = getCore(sessions, id)
        return this._rpcUndownload(core, resources, resourceId)
      },

      // Networking Methods
      async configureNetwork ({ configuration: { discoveryKey, announce, lookup, remember }, flush }) {
        if (discoveryKey.length !== 32) throw new Error('Invalid discovery key.')
        const keyString = discoveryKey.toString('hex')

        const join = announce || lookup
        var networkProm = null
        if (join) networkProm = this.networker.join(discoveryKey, { announce, lookup })
        else networkProm = this.networker.leave(discoveryKey)

        if (remember) {
          // TODO: Store network configuration in DB.
        } else {
          if (join) this._transientNetworkConfigurations.set(keyString, { announce, lookup, remember })
          else this._transientNetworkConfigurations.delete(keyString)
        }

        if (flush) {
          return networkProm
        }
        networkProm.catch(err => this.emit('swarm-error', err))
      },

      async getNetworkConfiguration ({ discoveryKey }) {
        // TODO: Get network configuration from DB.
      }
    })
  }

  // RPC Methods

  _rpcGet (core, seq, opts) {
    return new Promise((resolve, reject) => {
      core.get(seq, opts, (err, block) => {
        if (err) return reject(err)
        return resolve({ block })
      })
    })
  }

  _rpcDownload (core, resources, resourceId, opts) {
    return new Promise((resolve, reject) => {
      if (resources.has(resourceId)) throw new Error('Invalid resource id.')
      let downloaded = false
      const d = core.download(opts, (err) => {
        downloaded = true
        resources.delete(resourceId)
        if (err) return reject(err)
        return resolve()
      })
      if (downloaded) return
      resources.set(resourceId, d)
    })
  }

  _rpcUndownload (core, resources, resourceId) {
    const r = resources.get(resourceId)
    if (!r) throw new Error('Invalid resource id.')
    resources.delete(resourceId)
    core.undownload(r)
  }

  _rpcAppend (core, blocks) {
    return new Promise((resolve, reject) => {
      core.append(blocks, (err, seq) => {
        if (err) return reject(err)
        return resolve({
          length: core.length,
          byteLength: core.byteLength,
          seq
        })
      })
    })
  }

  _rpcUpdate (core, opts) {
    return new Promise((resolve, reject) => {
      core.update(opts, (err, block) => {
        if (err) return reject(err)
        return resolve({ block })
      })
    })
  }

  _rpcSeek (core, byteOffset, opts) {
    return new Promise((resolve, reject) => {
      core.seek(byteOffset, opts, (err, seq, blockOffset) => {
        if (err) return reject(err)
        return resolve({ seq, blockOffset })
      })
    })

  }

  _rpcHas (core, seq) {
    return new Promise((resolve, reject) => {
      core.ready(err => {
        if (err) return reject(err)
        return resolve({
          has: core.has(seq)
        })
      })
    })
  }

  // Public Methods
  ready () {
    return this.open()
  }
}

function getCore (sessions, id) {
  const core = sessions.get(id)
  if (!core) throw new Error('Invalid session.')
  return core
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
