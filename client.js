const maybe = require('call-me-maybe')
const hypercoreCrypto = require('hypercore-crypto')

const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')
const { Client: RPCClient } = require('./lib/rpc')

module.exports = class HyperspaceClient extends Nanoresource {
  constructor (opts = {}) {
    super()
    this._client = null
    this._sessions = []
  }

  _open () {
    this._client = new RPCClient()
  }

  _close () {
    return this._client.destroy()
  }

  ready (cb) {
    return maybe(cb, this.open())
  }

  get (key, opts = {}) {
    return new RemoteHypercore(this._client, 0, key, opts)
  }
}

class RemoteHypercore extends Nanoresource {
  constructor (client, id, key, opts) {
    super()
    this.key = key
    this.discoveryKey = null
    this.length = 0
    this.byteLength = 0
    this.writable = false

    this._client = client
    this._id = id

    this.ready(() => {})
  }

  async _open () {
    const rsp = await this._client.open({
      id: this._id,
      key: this._key,
      opts: {}
    })
    this.key = rsp.key
    this.discoveryKey = hypercoreCrypto.discoveryKey(this.key)
    this.writable = rsp.writable
    this.length = rsp.length
    this.byteLength = rsp.byteLength
    this.emit('ready')
  }

  ready (cb) {
    return maybe(cb, this.open())
  }

  async _append (blocks) {
    if (Buffer.isBuffer(blocks)) blocks = [blocks]
    const rsp = await this._client.append({
      id: this._id,
      blocks: blocks
    })
    this.length = rsp.length
    this.byteLength = rsp.byteLength
  }

  async _get (seq) {
    const rsp = await this._client.get({
      id: this._id,
      seq
    })
    return rsp.block
  }

  append (blocks, cb) {
    return maybe(cb, this._append(blocks))
  }

  get (seq, cb) {
    return maybe(cb, this._get(seq))
  }
}
