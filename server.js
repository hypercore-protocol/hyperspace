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

  _onConnection (client) {
    console.log('got a new connection')
    const sessions = new Map()
    client.onRequest(this, {
      async open ({ id, key, opts }) {
        console.log('in open')
        let core = sessions.get(id)
        if (core) throw new Error('Should not reuse session IDs')
        core = this.corestore.get({ key, ...opts })
        sessions.set(id, core)
        // TODO: Delete session if ready fails.
        await new Promise((resolve, reject) => {
          core.ready(err => {
            if (err) return reject(err)
            return resolve()
          })
        })
        return {
          key: core.key,
          length: core.length,
          byteLength: core.byteLength,
          writable: core.writable
        }
      },
      async close ({ id }) {
        console.log('close')
      },
      async get ({ id, seq }) {
        console.log('get')
      }
    })
  }

  async _startListening () {
    this.server = new RPCServer(this._onConnection.bind(this))
    return this.server.listen()
  }

  async _stopListening () {
    // TODO: Stop listening
  }

  // RPC Methods

  _rpcOpen (req) {
    const keyString = keyToString(req.key)
  }

  _rpcClose (req) {

  }

  _rpcGet (req) {

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
