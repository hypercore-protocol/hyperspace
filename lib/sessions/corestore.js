module.exports = class CorestoreSession {
  constructor (client, sessionState, corestore) {
    this._client = client
    this._corestore = corestore
    this._sessionState = sessionState

    const feedListener = (feed) => {
      this._client.corestore.onFeedNoReply({
        key: feed.key
      })
    }
    this._corestore.on('feed', feedListener)
    this._sessionState.addResource('@hypercore/feed', null, () => {
      this._corestore.removeListener('feed', feedListener)
    })
  }

  // RPC Methods

  async open ({ id, key, name, weak }) {
    if (this._sessionState.hasCore(id)) throw new Error('Session already in use.')

    const core = this._corestore.get({ key, _name: name, default: !!name })
    this._sessionState.addCore(id, core, weak)

    // TODO: Delete session if ready fails.
    await new Promise((resolve, reject) => {
      core.ready(err => {
        if (err) return reject(err)
        return resolve()
      })
    })

    const appendListener = () => {
      this._client.hypercore.onAppendNoReply({
        id,
        length: core.length,
        byteLength: core.byteLength
      })
    }
    core.on('append', appendListener)
    this._sessionState.addResource('@hypercore/append-' + id, null, () => {
      core.removeListener('append', appendListener)
    })

    const peerOpenListener = (peer) => {
      this._client.hypercore.onPeerOpenNoReply({
        id,
        peer: {
          type: peer.remoteType,
          remotePublicKey: peer.remotePublicKey,
          remoteAddress: peer.remoteAddress
        }
      })
    }
    core.on('peer-open', peerOpenListener)
    this._sessionState.addResource('@hypercore/peer-open-' + id, null, () => {
      core.removeListener('peer-open', peerOpenListener)
    })

    const peerRemoveListener = (peer) => {
      this._client.hypercore.onPeerRemoveNoReply({
        id,
        peer: {
          id: peer.id,
          remotePublicKey: peer.remotePublicKey,
          remoteAddress: peer.remoteAddress
        }
      })
    }
    core.on('peer-remove', peerRemoveListener)
    this._sessionState.addResource('@hypercore/peer-remove-' + id, null, () => {
      core.removeListener('peer-remove', peerRemoveListener)
    })

    if (weak) {
      const closeListener = () => {
        this._client.hypercore.onCloseNoReply({ id })
      }
      core.on('close', closeListener)
      this._sessionState.addResource('@hypercore/close-' + id, null, () => {
        core.removeListener('close', closeListener)
      })
    }

    return {
      key: core.key,
      length: core.length,
      byteLength: core.byteLength,
      writable: core.writable
    }
  }
}
