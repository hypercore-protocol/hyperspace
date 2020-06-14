module.exports = class NetworkSession {
  constructor (client, sessionState, networker, db, transientConfigurations) {
    this._client = client
    this._sessionState = sessionState
    this._networker = networker
    this._transientConfigurations = transientConfigurations
    this._db = db

    // TODO: Extract duplicate code from CorestoreSession

    const peerOpenListener = async (stream) => {
      this._client.network.onPeerOpenNoReply({
        id: 0,
        peer: {
          remotePublicKey: stream.remotePublicKey,
          remoteAddress: stream.remoteAddress,
          type: stream.remoteType
        }
      })
    }
    this._networker.on('handshake', peerOpenListener)
    this._sessionState.addResource('@network/peer-open', null, () => {
      this._networker.removeListener('handshake', peerOpenListener)
    })

    const peerRemoveListener = (stream) => {
      this._client.network.onPeerRemoveNoReply({
        id: 0,
        peer: {
          remotePublicKey: stream.remotePublicKey,
          remoteAddress: stream.remoteAddress,
          type: stream.remoteType
        }
      })
    }
    this._networker.on('stream-closed', peerRemoveListener)
    this._sessionState.addResource('@network/peer-remove', null, () => {
      this._networker.removeListener('stream-closed', peerRemoveListener)
    })
  }

  // RPC Methods

  async configureNetwork ({ configuration: { discoveryKey, announce, lookup, remember }, flush }) {
    if (discoveryKey.length !== 32) throw new Error('Invalid discovery key.')
    const dkeyString = discoveryKey.toString('hex')

    const join = announce || lookup
    var networkProm = null
    if (join) networkProm = this._networker.join(discoveryKey, { announce, lookup })
    else networkProm = this._networker.leave(discoveryKey)

    const networkConfiguration = { discoveryKey, announce, lookup, remember }
    if (remember) {
      await this._db.putNetworkConfiguration(networkConfiguration)
    } else {
      if (join) this._transientConfigurations.set(dkeyString, networkConfiguration)
      else this._transientConfigurations.delete(dkeyString)
    }

    if (flush) {
      return networkProm
    }
    // TODO: Error ignored here -- networker must emit it.
    networkProm.catch(() => {})
    return null
  }

  async getNetworkConfiguration ({ discoveryKey }) {
    const dkeyString = discoveryKey.toString('hex')
    if (this._transientConfigurations.has(dkeyString)) {
      return { configuration: this._transientConfigurations.get(dkeyString) }
    }
    const configuration = await this._db.getNetworkConfiguration(dkeyString)
    return configuration ? { configuration } : {}
  }

  async getAllNetworkConfigurations () {
    const storedConfigurations = await this._db.listNetworkConfigurations()
    return {
      configurations: [...storedConfigurations, ...this._transientConfigurations.values()]
    }
  }
}
