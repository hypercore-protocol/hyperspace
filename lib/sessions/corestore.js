module.exports = class CorestoreSession {
  constructor (client, sessionState, corestore) {
    this._client = client
    this._corestore = corestore
    this._sessionState = sessionState
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

    this._sessionState.addResource('@corestore/append-' + id, null, () => {
      core.removeListener('append', appendListener)
    })

    if (weak) {
      const closeListener = () => {
        this._client.hypercore.onCloseNoReply({ id })
      }
      core.on('close', closeListener)
      this._sessionState.addResource('@corestore/close-' + id, null, () => {
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
