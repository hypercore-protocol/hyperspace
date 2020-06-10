const maybe = require('call-me-maybe')
const codecs = require('codecs')
const hypercoreCrypto = require('hypercore-crypto')

const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')
const { Client: RPCClient } = require('./lib/rpc')

class Sessions {
  constructor () {
    this._counter = 0
    this._freeList = []
    this._remoteCores = new Map()
  }
  create (remoteCore) {
    const id = this._freeList.length ? this._freeList.pop() : this._counter++
    this._remoteCores.set(id, remoteCore)
    return id
  }
  delete (id) {
    this._remoteCores.delete(id)
    this._freeList.push(id)
  }
  get (id) {
    return this._remoteCores.get(id)
  }
}

module.exports = class RemoteCorestore extends Nanoresource {
  constructor (opts = {}) {
    super()
    this._client = opts.client
    this._name = opts.name
    this._sessions = opts.sessions || new Sessions()
  }

  _open () {
    if (this._client) return
    this._client = new RPCClient()
    this._client.onRequest(this, {
      onappend ({ id, length, byteLength}) {
        const remoteCore = this._sessions.get(id)
        if (!remoteCore) throw new Error('Invalid RemoteHypercore ID.')
        remoteCore._onappend({ length, byteLength })
      }
    })
  }

  _close () {
    if (this._name) return
    return this._client.destroy()
  }

  ready (cb) {
    return maybe(cb, this.open())
  }

  replicate () {
    throw new Error('Cannot call replicate on a RemoteCorestore')
  }

  default (opts = {}) {
    return this.get(null, { name: this._name })
  }

  get (key, opts = {}) {
    return new RemoteHypercore(this._client, this._sessions, key, opts)
  }

  namespace (name) {
    return new this.constructor({
      client: this._client,
      sessions: this._sessions,
      name,
    })
  }
}

class RemoteHypercore extends Nanoresource {
  constructor (client, sessions, key, opts) {
    super()
    this.key = key
    this.discoveryKey = null
    this.length = 0
    this.byteLength = 0
    this.writable = false

    this._client = client
    this._sessions = sessions
    this._name = opts.name
    this._id = this._sessions.create(this)

    this.ready(() => {})
  }

  ready (cb) {
    return maybe(cb, this.open())
  }

  // Events
  _onappend (rsp) {
    this.length = rsp.length
    this.byteLength = rsp.byteLength
    this.emit('append')
  }

  async _open () {
    const rsp = await this._client.open({
      id: this._id,
      key: this._key,
      name: this._name,
      opts: {}
    })
    this.key = rsp.key
    this.discoveryKey = hypercoreCrypto.discoveryKey(this.key)
    this.writable = rsp.writable
    this.length = rsp.length
    this.byteLength = rsp.byteLength
    this.emit('ready')
  }

  async _close () {
    await this._client.close({ id: this._id })
    this._sessions.delete(this._id)
    this.emit('close')
  }

  async _append (blocks) {
    if (Buffer.isBuffer(blocks)) blocks = [blocks]
    const rsp = await this._client.append({
      id: this._id,
      blocks
    })
    return rsp.seq
  }

  async _get (seq, opts) {
    const rsp = await this._client.get({
      ...opts,
      seq,
      id: this._id
    })
    if (opts && opts.valueEncoding) return codecs(opts.valueEncoding).decode(rsp.block)
    return rsp.block
  }

  async _update (opts) {
    await this.ready()
    if (typeof opts === 'number') opts = { minLength: opts }
    if (typeof opts.minLength !== 'number') opts.minLength = this.length + 1
    return this._client.update({
      ...opts,
      id: this._id
    })
  }

  async _seek (byteOffset, opts) {
    const rsp = await this._client.seek({
      byteOffset,
      ...opts,
      id: this._id
    })
    return {
      seq: rsp.seq,
      blockOffset: rsp.blockOffset
    }
  }

  async _has (seq) {
    const rsp = await this._client.has({
      seq,
      id: this._id
    })
    return rsp.has
  }

  append (blocks, cb) {
    return maybe(cb, this._append(blocks))
  }

  get (seq, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = null
    }
    return maybe(cb, this._get(seq, opts))
  }

  update (opts, cb) {
    return maybe(cb, this._update(opts))
  }

  seek (byteOffset, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = null
    }
    const seekProm = this._seek(byteOffset, opts)
    if (!cb) return seekProm
    seekProm
      .then(({ seq, blockOffset }) => process.nextTick(cb, null, seq, blockOffset))
      .catch(err => process.nextTick(cb, err))
  }

  has (seq, cb) {
    return maybe(cb, this._has(seq))
  }

  replicate () {
    throw new Error('Cannot call replicate on a RemoteHyperdrive')
  }
}
