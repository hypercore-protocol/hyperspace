const hypertrie = require('hypertrie')
const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')

const { NetworkStatus } = require('@hyperspace/rpc/messages')

const INTERNAL_NAMESPACE = '@hyperspace:internal'
const NETWORK_PREFIX = 'network'

module.exports = class HyperspaceDb extends Nanoresource {
  constructor (corestore) {
    super()
    this.corestore = corestore
    this._db = null
  }

  async _open () {
    this._namespacedStore = this.corestore.namespace(INTERNAL_NAMESPACE)
    await this._namespacedStore.ready()
    const dbFeed = this._namespacedStore.default()
    this._db = hypertrie(null, null, { feed: dbFeed })
    await new Promise((resolve, reject) => {
      this._db.ready(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  async setUserConfig (name, value) {
    return new Promise((resolve, reject) => {
      this._db.put('config/' + name, value, (err) => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  async getUserConfig (name) {
    return new Promise((resolve, reject) => {
      this._db.get('config/' + name, (err, node) => {
        if (err) return reject(err)
        return resolve(node && node.value)
      })
    })
  }

  async deleteUserConfig (name) {
    return new Promise((resolve, reject) => {
      this._db.del('config/' + name, (err) => {
        if (err) return reject(err)
        return resolve()
      })
    })
  }

  async putNetworkConfiguration (networkConfiguration) {
    const dkeyString = networkConfiguration.discoveryKey.toString('hex')
    return new Promise((resolve, reject) => {
      this._db.put(toDbKey(NETWORK_PREFIX, dkeyString), NetworkStatus.encode(networkConfiguration), err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  async removeNetworkConfiguration (discoveryKey) {
    if (Buffer.isBuffer(discoveryKey)) discoveryKey = discoveryKey.toString('hex')
    return new Promise((resolve, reject) => {
      this._db.del(toDbKey(NETWORK_PREFIX, discoveryKey), err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  async getNetworkConfiguration (discoveryKey) {
    const dkeyString = (typeof discoveryKey === 'string') ? discoveryKey : discoveryKey.toString('hex')
    return new Promise((resolve, reject) => {
      this._db.get(toDbKey(NETWORK_PREFIX, dkeyString), (err, node) => {
        if (err) return reject(err)
        return resolve(node && NetworkStatus.decode(node.value))
      })
    })
  }

  async listNetworkConfigurations () {
    return new Promise((resolve, reject) => {
      this._db.list(NETWORK_PREFIX, (err, nodes) => {
        if (err) return reject(err)
        return resolve(nodes.map(n => NetworkStatus.decode(n.value)))
      })
    })
  }
}

function toDbKey (prefix, key) {
  return prefix + '/' + key
}
