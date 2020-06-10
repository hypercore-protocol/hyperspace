const Corestore = require('corestore')
const Networker = require('corestore-swarm-networking')
const RPC = require('arpeecee')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const Sessions = require('./lib/sessions')
const {
  OpenRequest,
  OpenResponse,
  CloseRequest,
  CloseResponse,
  GetRequest,
  GetResponse,
  HypercoreOptions,
  Error
} = require('./lib/messages')

module.exports = class Hyperspace extends Nanoresource {
  constructor (opts = {}) {
    super()

    this.corestore = new Corestore(opts.storage || './storage')
    this.sessions = new Map()

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
  async _startListening () {

  }

  async _stopListening () {

  }

  // RPC Methods

  _rpcOpen (req) {
    const keyString = keyToString(req.key)
    let sessions = this.sessions.get(keyString)
    if (!sessions) {
      sessions = []
      this.sessions.set(keyString, sessions)
    }
    sessions
  }

  _rpcClose (req) {

  }

  _rpcGet (req) {

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
