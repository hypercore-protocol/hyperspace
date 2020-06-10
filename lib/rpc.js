const RPC = require('arpeecee')
const net = require('net')
const events = require('events')
const fs = require('fs')

const {
  OpenRequest,
  OpenResponse,
  CloseRequest,
  CloseResponse,
  GetRequest,
  GetResponse,
  AppendRequest,
  AppendResponse,
  AppendEvent,
  UpdateRequest,
  SeekRequest,
  SeekResponse,
  HasRequest,
  HasResponse,
  DownloadRequest,
  UndownloadRequest,
  RPCError
} = require('./messages')

const errorEncoding = {
  encode: RPCError.encode,
  encodingLength: RPCError.encodingLength,
  decode (buf, offset) {
    const { message, code, details } = RPCError.decode(buf, offset)
    errorEncoding.decode.bytes = RPCError.decode.bytes
    const err = new Error(message)
    err.code = code
    err.details = details
    return err
  }
}

function emitErrorMaybe (e, err) {
  if (e.listenerCount('error')) e.emit('error', err)
}

class Client extends events.EventEmitter {
  constructor () {
    super()
    this.rawSocket = net.connect('/tmp/hyperspace.sock')

    const rpc = new RPC({ errorEncoding })
    this._rpc = rpc
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('error', (err) => emitErrorMaybe(this, err))
    rpc.on('close', () => this.emit('close'))

    this._open = rpc.defineMethod({
      id: 0,
      requestEncoding: OpenRequest,
      responseEncoding: OpenResponse
    })

    this._close = rpc.defineMethod({
      id: 1,
      requestEncoding: CloseRequest,
      responseEncoding: RPC.NULL
    })

    this._get = rpc.defineMethod({
      id: 2,
      requestEncoding: GetRequest,
      responseEncoding: GetResponse
    })

    this._append = rpc.defineMethod({
      id: 3,
      requestEncoding: AppendRequest,
      responseEncoding: AppendResponse
    })

    this._update = rpc.defineMethod({
      id: 4,
      requestEncoding: UpdateRequest,
      responseEncoding: RPC.NULL
    })

    this._seek = rpc.defineMethod({
      id: 5,
      requestEncoding: SeekRequest,
      responseEncoding: SeekResponse
    })

    this._has = rpc.defineMethod({
      id: 6,
      requestEncoding: HasRequest,
      responseEncoding: HasResponse
    })

    this._download = rpc.defineMethod({
      id: 7,
      requestEncoding: DownloadRequest,
      responseEncoding: RPC.NULL
    })

    this._undownload = rpc.defineMethod({
      id: 8,
      requestEncoding: UndownloadRequest,
      responseEncoding: RPC.NULL
    })

    this._onappend = null
  }

  onRequest (context, handlers) {
    this._onappend = this._rpc.defineMethod({
      id: 9,
      requestEncoding: AppendEvent,
      responseEncoding: RPC.NULL,
      onrequest: handlers.onappend.bind(context)
    })
  }

  open (val) {
    return this._open.request(val)
  }

  close (val) {
    return this._close.request(val)
  }

  get (val) {
    return this._get.request(val)
  }

  append (val) {
    return this._append.request(val)
  }

  update (val) {
    return this._update.request(val)
  }

  seek (val) {
    return this._seek.request(val)
  }

  has (val) {
    return this._has.request(val)
  }

  download (val) {
    return this._download.request(val)
  }

  undownload (val) {
    return this._undownload.request(val)
  }

  destroy () {
    this.rawSocket.destroy()
  }
}

class Server {
  constructor (onclient) {
    this.clients = new Set()
    this.onclient = onclient
    this.server = net.createServer((rawSocket) => {
      const client = new ServerSocket(rawSocket)
      this.clients.add(client)
      client.on('close', () => this.clients.delete(client))
      onclient(client)
    })
  }

  close () {
    return new Promise((resolve, reject) => {
      this.server.once('close', () => {
        resolve()
      })
      this.server.close()
      for (const client of this.clients) client.destroy()
    })
  }

  listen () {
    return new Promise((resolve, reject) => {
      fs.unlink('/tmp/hyperspace.sock', () => {
        const done = (err) => {
          this.server.removeListener('listening', done)
          this.server.removeListener('error', done)
          if (err) reject(err)
          else resolve(err)
        }

        this.server.on('listening', done)
        this.server.on('error', done)
        this.server.listen('/tmp/hyperspace.sock')
      })
    })
  }
}

class ServerSocket extends events.EventEmitter {
  constructor (rawSocket) {
    super()
    this.rawSocket = rawSocket

    const rpc = new RPC({ errorEncoding })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('error', (err) => emitErrorMaybe(this, err))
    rpc.on('close', () => this.emit('close'))

    this._rpc = rpc
    this._open = null
    this._close = null
    this._get = null
    this._append = null
    this._update = null
    this._seek = null
    this._has = null
    this._download = null
    this._undownload = null

    this._onappend = rpc.defineMethod({
      id: 9,
      requestEncoding: AppendEvent,
      responseEncoding: RPC.NULL
    })
  }

  onRequest (context, handlers) {
    this._open = this._rpc.defineMethod({
      id: 0,
      requestEncoding: OpenRequest,
      responseEncoding: OpenResponse,
      onrequest: handlers.open.bind(context)
    })

    this._close = this._rpc.defineMethod({
      id: 1,
      requestEncoding: CloseRequest,
      responseEncoding: RPC.NULL,
      onrequest: handlers.close.bind(context)
    })

    this._get = this._rpc.defineMethod({
      id: 2,
      requestEncoding: GetRequest,
      responseEncoding: GetResponse,
      onrequest: handlers.get.bind(context)
    })

    this._append = this._rpc.defineMethod({
      id: 3,
      requestEncoding: AppendRequest,
      responseEncoding: AppendResponse,
      onrequest: handlers.append.bind(context)
    })

    this._update = this._rpc.defineMethod({
      id: 4,
      requestEncoding: UpdateRequest,
      responseEncoding: RPC.NULL,
      onrequest: handlers.update.bind(context)
    })

    this._seek = this._rpc.defineMethod({
      id: 5,
      requestEncoding: SeekRequest,
      responseEncoding: SeekResponse,
      onrequest: handlers.seek.bind(context)
    })

    this._has = this._rpc.defineMethod({
      id: 6,
      requestEncoding: HasRequest,
      responseEncoding: HasResponse,
      onrequest: handlers.has.bind(context)
    })

    this._download = this._rpc.defineMethod({
      id: 7,
      requestEncoding: DownloadRequest,
      responseEncoding: RPC.NULL,
      onrequest: handlers.download.bind(context)
    })

    this._undownload = this._rpc.defineMethod({
      id: 8,
      requestEncoding: UndownloadRequest,
      responseEncoding: RPC.NULL,
      onrequest: handlers.undownload.bind(context)
    })
  }

  onappend (val) {
    return this._onappend.requestNoReply(val)
  }

  destroy () {
    this.rawSocket.destroy()
  }
}

module.exports = {
  Server,
  Client
}
