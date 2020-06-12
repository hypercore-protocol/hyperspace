module.exports = class SessionState {
  constructor (references) {
    this.references = references
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

  deleteResource (id) {
    const res = this.resources.get(id)
    if (!res) throw new Error('Invalid resource: ' + id)
    res.dealloc()
    this.resources.delete(id)
  }

  hasCore (id) {
    return this.hypercores.has(id)
  }

  addCore (id, core) {
    const existing = this.hypercores.get(id)
    if (existing) throw new Error('Hypercore already exists in session: ' + id)
    this.references.increment(core)
    this.hypercores.set(id, core)
  }

  getCore (id) {
    const core = this.hypercores.get(id)
    if (!core) throw new Error('Invalid hypercore: ' + id)
    return core
  }

  deleteCore (id) {
    const core = this.hypercores.get(id)
    if (!core) throw new Error('Invalid hypercore: ' + id)
    this.references.decrement(core)
    this.hypercores.delete(id)
  }

  deleteAll () {
    for (const id of this.hypercores.keys()) {
      this.deleteCore(id)
    }
    for (const { dealloc } of this.resources.values()) {
      dealloc()
    }
    this.resources.clear()
  }
}
