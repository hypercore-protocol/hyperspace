const maybe = require('call-me-maybe')
const codecs = require('codecs')
const hypercoreCrypto = require('hypercore-crypto')
const { WriteStream, ReadStream } = require('hypercore-streams')

const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')
const HRPC = require('./lib/rpc')

const SOCK = '/tmp/hyperspace.sock'

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
    this._sock = opts.host || SOCK
    this._sessions = opts.sessions || new Sessions()
  }

  _open () {
    if (this._client) return
    this._client = HRPC.connect(this._sock)
    this._client.onRequest(this, {
      onAppend ({ id, length, byteLength}) {
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
    this._resourceId = 0

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

  createReadStream (opts) {
    return new ReadStream(this, opts)
  }

  createWriteStream (opts) {
    return new WriteStream(this, opts)
  }

  download (range, cb) {
    if (typeof range === 'number') range = { start: range, end: range + 1}
    if (Array.isArray(range)) range = { blocks: range }

    // much easier to run this in the client due to pbuf defaults
    if (range.blocks && typeof range.start !== 'number') {
      let min = -1
      let max = 0

      for (let i = 0; i < range.blocks.length; i++) {
        const blk = range.blocks[i]
        if (min === -1 || blk < min) min = blk
        if (blk >= max) max = blk + 1
      }

      range.start = min === -1 ? 0 : min
      range.end = max
    }
    if (range.end === -1) range.end = 0 // means the same

    const resourceId = this._resourceId++

    const prom = this._client.download({ ...range, id: this._id, resourceId })
    prom.catch(noop) // optional promise due to the hypercore signature
    prom.resourceId = resourceId

    maybe(cb, prom)
    return prom // always return prom as that one is the "cancel" token
  }

  undownload (dl, cb) {
    if (typeof dl.resourceId !== 'number') throw new Error('Must pass a download return value')
    const prom = this._client.undownload({ id: this._id, resourceId: dl.resourceId })
    prom.catch(noop) // optional promise due to the hypercore signature
    return maybe(cb, prom)
  }

  // TODO: Unimplemented methods

  registerExtension () {
  }

  replicate () {
    throw new Error('Cannot call replicate on a RemoteHyperdrive')
  }
}

function noop () {}
