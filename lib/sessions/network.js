const { intoPeer } = require('../common')

module.exports = class NetworkSession {
  constructor (client, sessionState, corestore, networker, db, networkStates, opts = {}) {
    this._client = client
    this._sessionState = sessionState
    this._networkStates = networkStates
    this._corestore = corestore
    this._networker = networker
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
    let called = false
    core.timeouts = {
      get: (cb) => {
        if (called) return cb(null)
        cbSet.add(() => mainTimeouts.get(cb))
      },
      update: (cb) => {
        if (called) return cb(null)
        cbSet.add(() => mainTimeouts.update(cb))
      }
    }
    return () => {
      called = true
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

  async _applyNetworkState (discoveryKey, dkeyString, { announce, lookup, flush, remember }) {
    const self = this

    let states = this._networkStates.get(dkeyString)
    if (!states) {
      states = new Map()
      this._networkStates.set(dkeyString, states)
    }

    const existingResource = states.has(this._sessionState)
    states.set(this._sessionState, { announce, lookup })
    // If this is the first time this session has configured this dkey, add the GCing.
    if (!existingResource) {
      this._sessionState.addResource('@network/configuration-' + dkeyString, null, () => {
        states.delete(this._sessionState)
        if (!states.size) this._networkStates.delete(dkeyString)
        // reduceAndConfigure might fail here, but this is a sync cleanup function so the error is unimportant.
        if (!this._networker.closed) reduceAndConfigure(false).catch(() => {})
      })
    }

    return reduceAndConfigure(true)

    async function reduceAndConfigure (rejoin) {
      let reducedAnnounce = false
      let reducedLookup = false
      if (!states.size) {
        const remembered = await self._db.getNetworkConfiguration(dkeyString)
        if (remembered) {
          reducedAnnounce = remembered.announce
          reducedLookup = remembered.lookup
        }
      } else {
        for (const s of states.values()) {
          reducedLookup = reducedLookup || s.lookup
          reducedAnnounce = reducedAnnounce || s.announce
          if (reducedLookup && reducedAnnounce) break
        }
      }
      return self._networker.configure(discoveryKey, {
        announce: reducedAnnounce,
        lookup: reducedLookup,
        flush,
        rejoin,
        // remember/discoveryKey are passed so that they will be saved in the networker's internal configurations list.
        remember,
        discoveryKey
      })
    }
  }

  async configure ({ configuration: { discoveryKey, announce, lookup, remember }, flush, copyFrom, overwrite }) {
    if (discoveryKey.length !== 32) throw new Error('Invalid discovery key.')
    if (copyFrom && copyFrom.length !== 32) throw new Error('Must copy from a valid discovery key.')

    const dkeyString = discoveryKey.toString('hex')

    const restoreTimeouts = this._setConfiguringTimeouts(discoveryKey)
    var networkProm = null

    let previous = this.status({ discoveryKey })
    if (!previous.status) {
      previous = { status: await this._db.getNetworkConfiguration(dkeyString) }
    }
    if (previous.status && !overwrite) {
      if (restoreTimeouts) restoreTimeouts()
      return previous
    }

    try {
      if (copyFrom) {
        const { status: config } = await this.status({ discoveryKey: copyFrom })
        if (announce === undefined) announce = config && config.announce
        if (lookup === undefined) lookup = config && config.lookup
        if (remember === undefined) remember = config && config.remember
      }

      if (this._noAnnounce) announce = false
      // This will create a network configuration by aggregating settings across sessions.
      networkProm = this._applyNetworkState(discoveryKey, dkeyString, { announce, lookup, flush, remember })

      const networkConfiguration = { discoveryKey, announce, lookup, remember }
      if (remember) await this._db.putNetworkConfiguration(networkConfiguration)
    } finally {
      if (restoreTimeouts) restoreTimeouts()
    }

    if (flush) await networkProm
    else networkProm.catch(() => {})

    return this.status({ discoveryKey })
  }

  status ({ discoveryKey }) {
    const status = this._networker.status(discoveryKey)
    return { status }
  }

  allStatuses () {
    const statuses = this._networker.allStatuses()
    return { statuses }
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
