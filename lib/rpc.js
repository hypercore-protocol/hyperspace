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

class HRPCServiceCorestore {
  constructor (rpc) {
    const service = rpc.defineService({ id: 1 })

    this._open = service.defineMethod({
      id: 1,
      requestEncoding: messages.OpenRequest,
      responseEncoding: messages.OpenResponse
    })

    this._onFeed = service.defineMethod({
      id: 2,
      requestEncoding: messages.FeedEvent,
      responseEncoding: RPC.NULL
    })
  }

  onRequest (context, handlers = context) {
    if (handlers.open) this._open.onrequest = handlers.open.bind(context)
    if (handlers.onFeed) this._onFeed.onrequest = handlers.onFeed.bind(context)
  }

  open (data) {
    return this._open.request(data)
  }

  openNoReply (data) {
    return this._open.requestNoReply(data)
  }

  onFeed (data) {
    return this._onFeed.request(data)
  }

  onFeedNoReply (data) {
    return this._onFeed.requestNoReply(data)
  }
}

class HRPCServiceHypercore {
  constructor (rpc) {
    const service = rpc.defineService({ id: 2 })

    this._get = service.defineMethod({
      id: 1,
      requestEncoding: messages.GetRequest,
      responseEncoding: messages.GetResponse
    })

    this._append = service.defineMethod({
      id: 2,
      requestEncoding: messages.AppendRequest,
      responseEncoding: messages.AppendResponse
    })

    this._update = service.defineMethod({
      id: 3,
      requestEncoding: messages.UpdateRequest,
      responseEncoding: RPC.NULL
    })

    this._seek = service.defineMethod({
      id: 4,
      requestEncoding: messages.SeekRequest,
      responseEncoding: messages.SeekResponse
    })

    this._has = service.defineMethod({
      id: 5,
      requestEncoding: messages.HasRequest,
      responseEncoding: messages.HasResponse
    })

    this._download = service.defineMethod({
      id: 6,
      requestEncoding: messages.DownloadRequest,
      responseEncoding: RPC.NULL
    })

    this._undownload = service.defineMethod({
      id: 7,
      requestEncoding: messages.UndownloadRequest,
      responseEncoding: RPC.NULL
    })

    this._close = service.defineMethod({
      id: 8,
      requestEncoding: messages.CloseRequest,
      responseEncoding: RPC.NULL
    })

    this._onAppend = service.defineMethod({
      id: 9,
      requestEncoding: messages.AppendEvent,
      responseEncoding: RPC.NULL
    })

    this._onClose = service.defineMethod({
      id: 10,
      requestEncoding: messages.CloseEvent,
      responseEncoding: RPC.NULL
    })

    this._onPeerAdd = service.defineMethod({
      id: 11,
      requestEncoding: messages.PeerEvent,
      responseEncoding: RPC.NULL
    })

    this._onPeerRemove = service.defineMethod({
      id: 12,
      requestEncoding: messages.PeerEvent,
      responseEncoding: RPC.NULL
    })
  }

  onRequest (context, handlers = context) {
    if (handlers.get) this._get.onrequest = handlers.get.bind(context)
    if (handlers.append) this._append.onrequest = handlers.append.bind(context)
    if (handlers.update) this._update.onrequest = handlers.update.bind(context)
    if (handlers.seek) this._seek.onrequest = handlers.seek.bind(context)
    if (handlers.has) this._has.onrequest = handlers.has.bind(context)
    if (handlers.download) this._download.onrequest = handlers.download.bind(context)
    if (handlers.undownload) this._undownload.onrequest = handlers.undownload.bind(context)
    if (handlers.close) this._close.onrequest = handlers.close.bind(context)
    if (handlers.onAppend) this._onAppend.onrequest = handlers.onAppend.bind(context)
    if (handlers.onClose) this._onClose.onrequest = handlers.onClose.bind(context)
    if (handlers.onPeerAdd) this._onPeerAdd.onrequest = handlers.onPeerAdd.bind(context)
    if (handlers.onPeerRemove) this._onPeerRemove.onrequest = handlers.onPeerRemove.bind(context)
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

  onClose (data) {
    return this._onClose.request(data)
  }

  onCloseNoReply (data) {
    return this._onClose.requestNoReply(data)
  }

  onPeerAdd (data) {
    return this._onPeerAdd.request(data)
  }

  onPeerAddNoReply (data) {
    return this._onPeerAdd.requestNoReply(data)
  }

  onPeerRemove (data) {
    return this._onPeerRemove.request(data)
  }

  onPeerRemoveNoReply (data) {
    return this._onPeerRemove.requestNoReply(data)
  }
}

class HRPCServiceNetwork {
  constructor (rpc) {
    const service = rpc.defineService({ id: 3 })

    this._configureNetwork = service.defineMethod({
      id: 1,
      requestEncoding: messages.ConfigureNetworkRequest,
      responseEncoding: RPC.NULL
    })

    this._getNetworkConfiguration = service.defineMethod({
      id: 2,
      requestEncoding: messages.GetNetworkConfigurationRequest,
      responseEncoding: messages.GetNetworkConfigurationResponse
    })
  }

  onRequest (context, handlers = context) {
    if (handlers.configureNetwork) this._configureNetwork.onrequest = handlers.configureNetwork.bind(context)
    if (handlers.getNetworkConfiguration) this._getNetworkConfiguration.onrequest = handlers.getNetworkConfiguration.bind(context)
  }

  configureNetwork (data) {
    return this._configureNetwork.request(data)
  }

  configureNetworkNoReply (data) {
    return this._configureNetwork.requestNoReply(data)
  }

  getNetworkConfiguration (data) {
    return this._getNetworkConfiguration.request(data)
  }

  getNetworkConfigurationNoReply (data) {
    return this._getNetworkConfiguration.requestNoReply(data)
  }
}

module.exports = class HRPCSession extends HRPC {
  constructor (rawSocket) {
    super()
    this.rawSocket = rawSocket

    const rpc = new RPC({ errorEncoding })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('close', () => this.emit('close'))
    rpc.on('error', (err) => {
      if (this.listenerCount('error')) this.emit('error', err)
    })

    this.corestore = new HRPCServiceCorestore(rpc)
    this.hypercore = new HRPCServiceHypercore(rpc)
    this.network = new HRPCServiceNetwork(rpc)
  }

  destroy (err) {
    this.rawSocket.destroy(err)
  }
}
