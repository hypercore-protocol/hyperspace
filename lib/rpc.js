const RPC = require('arpeecee')
const net = require('net')
const events = require('events')
const fs = require('fs')

class Client extends events.EventEmitter {
  constructor () {
    super()
    this.rawSocket = net.connect('/tmp/hyperspace.sock')

    const rpc = new RPC()
    rpc.pipe(this.rawSocket).pipe(rpc)

    this._open = rpc.defineMethod({
      id: 0,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL,
    })

    this._close = rpc.defineMethod({
      id: 1,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL,
    })

    this._get = rpc.defineMethod({
      id: 2,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL,
    })
  }

  open (val) {
    return this._open.request(val)
  }

  close () {
    return this._close.request(val)
  }

  get () {
    return this._get.request(val)
  }

  destroy () {
    this.rawSocket.destroy()
  }
}

class Server {
  constructor (onclient) {
    this.onclient = onclient
    this.server = net.createServer(function (rawSocket) {
      onclient(new ServerSocket(rawSocket))
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

    const rpc = new RPC()
    rpc.pipe(this.rawSocket).pipe(rpc)

    this._rpc = rpc
    this._open = null
    this._close = null
    this._get = null
  }

  onRequest (handlers) {
    this._open = this._rpc.defineMethod({
      id: 0,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL,
      onrequest: handlers.open
    })

    this._close = this._rpc.defineMethod({
      id: 1,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL,
      onrequest: handlers.close
    })

    this._get = this._rpc.defineMethod({
      id: 2,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL,
      onrequest: handlers.get
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
