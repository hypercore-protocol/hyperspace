const { EventEmitter } = require('events')

module.exports = class ReferenceCounter extends EventEmitter {
  constructor () {
    super()
    this._references = new Map()
  }

  increment (core) {
    const oldCount = this._references.get(core) || 0
    this._references.set(core, oldCount + 1)
  }

  decrement (core) {
    const currentCount = this._references.get(core)
    this._references.set(core, currentCount - 1)
    if (currentCount - 1) return Promise.resolve()
    this._references.delete(core)
    return new Promise((resolve, reject) => {
      core.close(err => {
        if (err && this.listenerCount('error')) this.emit('error', err)
        return resolve(null)
      })
    })
  }
}
