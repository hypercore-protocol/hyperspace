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

    const peerAddListener = (peer) => {
      this._client.network.onPeerAddNoReply({
        id: 0,
        peer: intoPeer(peer)
      })
    }
    this._networker.on('peer-add', peerAddListener)
    this._sessionState.addResource('@network/peer-add', null, () => {
      this._networker.removeListener('handshake', peerAddListener)
    })

    const peerRemoveListener = (peer) => {
      // If the peer does not have a remotePublicKey, then the handshake did not complete.
      if (!peer.remotePublicKey) return
      this._client.network.onPeerRemoveNoReply({
        id: 0,
        peer: intoPeer(peer)
      })
    }
    this._networker.on('peer-remove', peerRemoveListener)
    this._sessionState.addResource('@network/peer-remove', null, () => {
      this._networker.removeListener('peer-remove', peerRemoveListener)
    })
  }

  _setConfiguringTimeouts (discoveryKey) {
    // technically the core can load *during* the configuration call as well
    // in practice that wont imply the pipelining guarantee so we dont need
    // to worry about it
    if (!this._corestore.isLoaded({ discoveryKey })) return
    const core = this._corestore.get({ discoveryKey })
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

  open () {
    return {
      peers: [...this._networker.peers].map(intoPeer)
    }
  }

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

      networkProm = this._networker.configure(discoveryKey, { announce, lookup })

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

  async status ({ discoveryKey }) {
    const configuration = await this._getConfiguration(discoveryKey)
    return configuration ? { status: configuration } : {}
  }

  async allStatuses () {
    const storedConfigurations = await this._db.listNetworkConfigurations()
    return {
      statuses: [...storedConfigurations, ...this._transientConfigurations.values()]
    }
  }
}
