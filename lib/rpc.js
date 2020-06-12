const messages = require('./messages')
const HRPC = require('hrpc-runtime')
const RPC = require('hrpc-runtime/rpc')

const errorEncoding = {
  encode: messages.RPCError.encode,
  encodingLength: messages.RPCError.encodingLength,
  decode (buf, offset) {
    const { message, code, errno, details } = messages.RPCError.decode(buf, offset)
    errorEncoding.decode.bytes = messages.RPCError.decode.bytes
    const err = new Error(message)
    err.code = code
    err.errno = errno
    err.details = details
    return err
  }
}

module.exports = class HRPCSession extends HRPC {
  constructor (rawSocket) {
    super()
    this.rawSocket = rawSocket

    const rpc = this._rpc = new RPC({ errorEncoding })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('close', () => this.emit('close'))
    rpc.on('error', (err) => {
      if (this.listenerCount('error')) this.emit('error', err)
    })

    this._open = this._rpc.defineMethod({
      id: 1,
      requestEncoding: messages.OpenRequest,
      responseEncoding: messages.OpenResponse,
    })

    this._get = this._rpc.defineMethod({
      id: 2,
      requestEncoding: messages.GetRequest,
      responseEncoding: messages.GetResponse,
    })

    this._append = this._rpc.defineMethod({
      id: 3,
      requestEncoding: messages.AppendRequest,
      responseEncoding: messages.AppendResponse,
    })

    this._update = this._rpc.defineMethod({
      id: 4,
      requestEncoding: messages.UpdateRequest,
      responseEncoding: RPC.NULL,
    })

    this._seek = this._rpc.defineMethod({
      id: 5,
      requestEncoding: messages.SeekRequest,
      responseEncoding: messages.SeekResponse,
    })

    this._has = this._rpc.defineMethod({
      id: 6,
      requestEncoding: messages.HasRequest,
      responseEncoding: messages.HasResponse,
    })

    this._download = this._rpc.defineMethod({
      id: 7,
      requestEncoding: messages.DownloadRequest,
      responseEncoding: RPC.NULL,
    })

    this._undownload = this._rpc.defineMethod({
      id: 8,
      requestEncoding: messages.UndownloadRequest,
      responseEncoding: RPC.NULL,
    })

    this._close = this._rpc.defineMethod({
      id: 9,
      requestEncoding: messages.CloseRequest,
      responseEncoding: RPC.NULL,
    })

    this._onAppend = this._rpc.defineMethod({
      id: 10,
      requestEncoding: messages.AppendEvent,
      responseEncoding: RPC.NULL,
    })
  }

  onRequest (context, handlers) {
    if (!handlers) {
      handlers = context
      context = null
    }
    if (handlers.open) this._open.onrequest = handlers.open.bind(context)
    if (handlers.get) this._get.onrequest = handlers.get.bind(context)
    if (handlers.append) this._append.onrequest = handlers.append.bind(context)
    if (handlers.update) this._update.onrequest = handlers.update.bind(context)
    if (handlers.seek) this._seek.onrequest = handlers.seek.bind(context)
    if (handlers.has) this._has.onrequest = handlers.has.bind(context)
    if (handlers.download) this._download.onrequest = handlers.download.bind(context)
    if (handlers.undownload) this._undownload.onrequest = handlers.undownload.bind(context)
    if (handlers.close) this._close.onrequest = handlers.close.bind(context)
    if (handlers.onAppend) this._onAppend.onrequest = handlers.onAppend.bind(context)
  }

  open (data) {
    return this._open.request(data)
  }

  openNoReply (data) {
    return this._open.requestNoReply(data)
  }

  get (data) {
    return this._get.request(data)
  }

  getNoReply (data) {
    return this._get.requestNoReply(data)
  }

  append (data) {
    return this._append.request(data)
  }

  appendNoReply (data) {
    return this._append.requestNoReply(data)
  }

  update (data) {
    return this._update.request(data)
  }

  updateNoReply (data) {
    return this._update.requestNoReply(data)
  }

  seek (data) {
    return this._seek.request(data)
  }

  seekNoReply (data) {
    return this._seek.requestNoReply(data)
  }

  has (data) {
    return this._has.request(data)
  }

  hasNoReply (data) {
    return this._has.requestNoReply(data)
  }

  download (data) {
    return this._download.request(data)
  }

  downloadNoReply (data) {
    return this._download.requestNoReply(data)
  }

  undownload (data) {
    return this._undownload.request(data)
  }

  undownloadNoReply (data) {
    return this._undownload.requestNoReply(data)
  }

  close (data) {
    return this._close.request(data)
  }

  closeNoReply (data) {
    return this._close.requestNoReply(data)
  }

  onAppend (data) {
    return this._onAppend.request(data)
  }

  onAppendNoReply (data) {
    return this._onAppend.requestNoReply(data)
  }

  destroy (err) {
    this.rawSocket.destroy(err)
  }
}
