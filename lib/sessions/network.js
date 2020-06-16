const { intoPeer } = require('../common')

module.exports = class NetworkSession {
  constructor (client, sessionState, corestore, networker, db, transientConfigurations, opts = {}) {
    this._client = client
    this._sessionState = sessionState
    this._corestore = corestore
    this._networker = networker
    this._transientConfigurations = transientConfigurations
    this._db = db
    this._noAnnounce = opts.noAnnounce

    // TODO: Extract duplicate code from CorestoreSession

    const peerOpenListener = (stream) => {
      this._client.network.onPeerOpenNoReply({
        id: 0,
        peer: intoPeer(stream)
      })
    }
    this._networker.on('handshake', peerOpenListener)
    this._sessionState.addResource('@network/peer-open', null, () => {
      this._networker.removeListener('handshake', peerOpenListener)
    })

    const peerRemoveListener = (stream) => {
      // If the stream does not have a remotePublicKey, then the handshake did not complete.
      if (!stream.remotePublicKey) return
      this._client.network.onPeerRemoveNoReply({
        id: 0,
        peer: intoPeer(stream)
      })
    }
    this._networker.on('stream-closed', peerRemoveListener)
    this._sessionState.addResource('@network/peer-remove', null, () => {
      this._networker.removeListener('stream-closed', peerRemoveListener)
    })
  }

  _setConfiguringTimeouts (discoveryKey) {
    const core = this._corestore.get({ discoveryKey })
    if (!core) return null
    const cbSet = new Set()
    const mainTimeouts = core.timeouts
    core.timeouts = {
      get: (cb) => {
        cbSet.add(() => mainTimeouts.get(cb))
      },
      update: (cb) => {
        cbSet.add(() => mainTimeouts.update(cb))
      }
    }
    return () => {
      core.timeouts = mainTimeouts
      for (const cb of cbSet) cb()
    }
  }

  // RPC Methods

  async configure ({ configuration: { discoveryKey, announce, lookup, remember }, flush, copyFrom, overwrite }) {
    if (discoveryKey.length !== 32) throw new Error('Invalid discovery key.')
    if (copyFrom && copyFrom.length !== 32) throw new Error('Must copy from a valid discovery key.')
    const dkeyString = discoveryKey.toString('hex')

    const restoreTimeouts = this._setConfiguringTimeouts(discoveryKey)
    var networkProm = null

    const existing = await this._getConfiguration(discoveryKey)
    if (existing && !overwrite) {
      if (restoreTimeouts) restoreTimeouts()
      return
    }

    try {
      if (copyFrom) {
        const config = await this._getConfiguration(copyFrom)
        if (announce === undefined) announce = config && config.announce
        if (lookup === undefined) lookup = config && config.lookup
        if (remember === undefined) remember = config && config.remember
      }

      const join = announce || lookup
      if (this._noAnnounce) announce = false

      if (join) networkProm = this._networker.join(discoveryKey, { announce, lookup })
      else networkProm = this._networker.leave(discoveryKey)

      const networkConfiguration = { discoveryKey, announce, lookup, remember }
      if (remember) {
        if (join) await this._db.putNetworkConfiguration(networkConfiguration)
        else await this._db.removeNetworkConfiguration(dkeyString)
      } else {
        if (join) this._transientConfigurations.set(dkeyString, networkConfiguration)
        else this._transientConfigurations.delete(dkeyString)
      }
    } finally {
      if (restoreTimeouts) restoreTimeouts()
    }

    if (flush) {
      return networkProm
    }
    // TODO: Error ignored here -- networker must emit it.
    networkProm.catch(() => {})
    return null
  }

  async _getConfiguration (discoveryKey) {
    const dkeyString = discoveryKey.toString('hex')
    if (this._transientConfigurations.has(dkeyString)) {
      return this._transientConfigurations.get(dkeyString)
    }
    const configuration = await this._db.getNetworkConfiguration(dkeyString)
    return configuration
  }

  async getConfiguration ({ discoveryKey }) {
    const configuration = await this._getConfiguration(discoveryKey)
    return configuration ? { configuration } : {}
  }

  async getAllConfigurations () {
    const storedConfigurations = await this._db.listNetworkConfigurations()
    return {
      configurations: [...storedConfigurations, ...this._transientConfigurations.values()]
    }
  }

  async listPeers () {
    const peers = []
    for (const stream of this._networker.streams) {
      peers.push(intoPeer(stream))
    }
    return { peers }
  }
}
