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
      this._networker.removeListener('peer-add', peerAddListener)
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
      publicKey: this._networker.keyPair.publicKey,
      peers: [...this._networker.peers].map(intoPeer)
    }
  }

  async configure ({ configuration: { discoveryKey, announce, lookup, remember }, resourceId, flush, copyFrom, overwrite }) {
    if (discoveryKey.length !== 32) throw new Error('Invalid discovery key.')
    if (copyFrom && copyFrom.length !== 32) throw new Error('Must copy from a valid discovery key.')
    const dkeyString = discoveryKey.toString('hex')

    const restoreTimeouts = this._setConfiguringTimeouts(discoveryKey)
    var networkProm = null

    const previous = await this._getConfiguration(discoveryKey)
    if (previous && !overwrite) {
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
      }
      // Don't retain a list of previous entries.
      if (previous) previous.previous = null
      this._transientConfigurations.set(dkeyString, { ...networkConfiguration, resourceId, previous })
    } finally {
      if (restoreTimeouts) restoreTimeouts()
    }

    // If remember is false, then the configuration should be reverted when the session closes.
    if (!remember && resourceId !== undefined) {
      this._sessionState.addResource(resourceId, null, () => this.unconfigure({ discoveryKey, resourceId }))
    }

    // If this is overwriting an old configuration, then any old session state should be deleted.
    if (previous && previous.resourceId !== undefined && resourceId !== undefined) {
      this._sessionState.deleteResource(previous.resourceId, true)
    }

    if (flush) {
      return networkProm
    }
    // TODO: Error ignored here -- networker must emit it.
    networkProm.catch(() => {})
    return null
  }

  async unconfigure ({ discoveryKey, resourceId }) {
    if (discoveryKey.length !== 32) throw new Error('Invalid discovery key.')
    const dkeyString = discoveryKey.toString('hex')
    const currentConfig = this._transientConfigurations.get(dkeyString)
    if (!currentConfig || currentConfig.resourceId !== resourceId) return null
    const previous = currentConfig.previous
    const oldConfig = {
      discoveryKey,
      announce: !!(previous && previous.announce),
      lookup: !!(previous && previous.lookup),
      remember: !!(previous && previous.remember)
    }
    await this.configure({ configuration: oldConfig, overwrite: true })
    // If unconfigure is being run during session cleanup, the resource might already be deleted.
    try {
      this._sessionState.deleteResource(resourceId, true)
    } catch (err) {}
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
    const transientConfigurations = [...this._transientConfigurations.values()].filter(c => !c.remember)
    return {
      statuses: [...storedConfigurations, ...transientConfigurations]
    }
  }

  registerExtension ({ resourceId, name }) {
    const client = this._client

    const ext = this._networker.registerExtension(name, {
      onmessage (data, from) {
        client.network.onExtensionNoReply({
          id: 0,
          resourceId,
          remotePublicKey: from.remotePublicKey,
          data
        })
      }
    })
    this._sessionState.addResource(resourceId, ext, () => ext.destroy())
  }

  unregisterExtension ({ resourceId }) {
    this._sessionState.deleteResource(resourceId)
  }

  sendExtension ({ resourceId, remotePublicKey, data }) {
    const ext = this._sessionState.getResource(resourceId)

    if (!remotePublicKey) {
      ext.broadcast(data)
      return
    }

    // TODO: Should maintain a map to make this faster.
    for (const peer of this._networker.peers) {
      if (peer.remotePublicKey && peer.remotePublicKey.equals(remotePublicKey)) {
        ext.send(data, peer)
      }
    }
  }
}
