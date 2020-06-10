const Corestore = require('corestore')
const Networker = require('corestore-swarm-networking')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const { Server: RPCServer } = require('./lib/rpc')

module.exports = class Hyperspace extends Nanoresource {
  constructor (opts = {}) {
    super()
    this.corestore = new Corestore(opts.storage || './storage')
    // Set in _open
    this.server = null
    this._references = new Map()
  }

  // Nanoresource Methods

  _open () {
    return Promise.all([
      this.corestore.ready(),
      this._startListening()
    ])
  }

  _close () {
    return Promise.all([
      this.corestore.close(),
      this._stopListening()
    ])
  }

  // Private Methods

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
      async open ({ id, key, name, opts }) {
        let core = sessions.get(id)
        if (core) throw new Error('Should not reuse session IDs')

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
          client.onappend({
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

      async close ({ id }) {
        const core = sessions.get(id)
        if (!core) throw new Error('Invalid session.')
        let unlistens = unlistensBySession.get(id)
        if (unlistens) {
          for (const unlisten of unlistens) unlisten()
        }
        unlistensBySession.delete(id)
        sessions.delete(id)
        await this._decrementCore(core)
      },

      async get ({ id, seq, wait, ifAvailable }) {
        const core = sessions.get(id)
        if (!core) throw new Error('Invalid session.')
        return this._rpcGet(core, seq, { ifAvailable, wait })
      },

      async append ({ id, blocks }) {
        const core = sessions.get(id)
        if (!core) throw new Error('Invalid session.')
        return this._rpcAppend(core, blocks)
      },

      async update ({ id, ifAvailable, minLength, hash }) {
        const core = sessions.get(id)
        if (!core) throw new Error('Invalid session.')
        return this._rpcUpdate(core, { ifAvailable, minLength, hash })
      },

      async seek ({ id, byteOffset, start, end, wait, ifAvailable }) {
        const core = sessions.get(id)
        if (!core) throw new Error('Invalid session.')
        return this._rpcSeek(core, byteOffset, { start, end, wait, ifAvailable })
      },

      async has ({ id, seq }) {
        const core = sessions.get(id)
        if (!core) throw new Error('Invalid session.')
        return this._rpcHas(core, seq)
      }
    })
  }

  async _startListening () {
    this.server = new RPCServer(this._onConnection.bind(this))
    return this.server.listen()
  }

  async _stopListening () {
    return this.server.close()
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

function keyToString (key) {
  if (typeof key === 'string') return key
  return key.toString('hex')
}

function keyFromString (key) {
  if (Buffer.isBuffer(key)) return key
  return Buffer.from(key, 'hex')
}
