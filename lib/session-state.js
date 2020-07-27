module.exports = class SessionState {
  constructor (corestore) {
    this.corestore = corestore
    this.hypercores = new Map()
    this.resources = new Map()
  }

  addResource (id, value, dealloc) {
    const res = this.resources.get(id)
    if (res) {
      dealloc()
      throw new Error('Resource already exists: ' + id)
    }
    this.resources.set(id, {
      value,
      dealloc
    })
  }

  hasResource (id) {
    return this.resources.has(id)
  }

  getResource (id) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    return res.value
  }

  deleteResource (id, noDealloc) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    if (!noDealloc) res.dealloc()
    this.resources.delete(id)
  }

  hasCore (id) {
    return this.hypercores.has(id)
  }

  addCore (id, core, isWeak) {
    if (this.hypercores.has(id)) throw new Error('Hypercore already exists in session: ' + id)
    if (!isWeak) this.corestore.cache.increment(core.discoveryKey.toString('hex'))
    this.hypercores.set(id, { core, isWeak })
  }

  getCore (id) {
    if (!this.hypercores.has(id)) throw new Error('Invalid hypercore: ' + id)
    const { core } = this.hypercores.get(id)
    return core
  }

  deleteCore (id) {
    if (!this.hypercores.has(id)) throw new Error('Invalid hypercore: ' + id)
    const { core, isWeak } = this.hypercores.get(id)
    if (!isWeak) this.corestore.cache.decrement(core.discoveryKey.toString('hex'))
    this.hypercores.delete(id)
  }

  deleteAll () {
    for (const { dealloc } of this.resources.values()) {
      dealloc()
    }
    for (const id of this.hypercores.keys()) {
      this.deleteCore(id)
    }
    this.resources.clear()
  }
}
