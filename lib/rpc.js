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
  Error
} = require('./messages')

function emitErrorMaybe (e, err) {
  if (e.listenerCount('error')) e.emit('error', err)
}

class Client extends events.EventEmitter {
  constructor () {
    super()
    this.rawSocket = net.connect('/tmp/hyperspace.sock')

    const rpc = new RPC({ errorEncoding: Error })
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

    const rpc = new RPC({ errorEncoding: Error })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('error', (err) => emitErrorMaybe(this, err))
    rpc.on('close', () => this.emit('close'))

    this._rpc = rpc
    this._open = null
    this._close = null
    this._get = null
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
  }

  destroy () {
    this.rawSocket.destroy()
  }
}

module.exports = {
  Server,
  Client
}
