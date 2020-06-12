module.exports = class NetworkSession {
  constructor (client, sessionState, networker, db, transientConfigurations) {
    this._client = client
    this._sessionState = sessionState
    this._networker = networker
    this._transientConfigurations = transientConfigurations
    this._db = db
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
    // TODO: Need to handle this error correctly.
    networkProm.catch(err => this.emit('swarm-error', err))
    return null
  }

  async getNetworkConfiguration ({ discoveryKey }) {
    const dkeyString = discoveryKey.toString('hex')
    if (this._transientConfigurations.has(dkeyString)) {
      return this._transientConfigurations.get(dkeyString)
    }
    const configuration = await this._db.getNetworkConfiguration(dkeyString)
    return configuration || {}
  }
}
