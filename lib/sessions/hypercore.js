module.exports = class HypercoreSession {
  constructor (client, sessionState) {
    this._client = client
    this._sessionState = sessionState
    this._downloads = new Map()
  }

  // RPC Methods

  async close ({ id }) {
    this._sessionState.deleteCore(id)
    this._sessionState.deleteResource('@hypercore/append-' + id)
    this._sessionState.deleteResource('@hypercore/peer-open-' + id)
    this._sessionState.deleteResource('@hypercore/peer-remove-' + id)
    if (this._sessionState.hasResource('@hypercore/close-' + id)) {
      this._sessionState.deleteResource('@hypercore/close-' + id)
    }
    const downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    for (const resourceId of downloadSet) {
      this._sessionState.deleteResource(resourceId)
    }
    this._downloads.delete(id)
  }

  async get ({ id, seq, wait, ifAvailable }) {
    const core = this._sessionState.getCore(id)
    return new Promise((resolve, reject) => {
      core.get(seq, { wait, ifAvailable }, (err, block) => {
        if (err) return reject(err)
        return resolve({ block })
      })
    })
  }

  async append ({ id, blocks }) {
    const core = this._sessionState.getCore(id)
    return new Promise((resolve, reject) => {
      core.append(blocks, (err, seq) => {
        if (err) return reject(err)
        return resolve({
          length: core.length,
          byteLength: core.byteLength,
          seq
        })
      })
    })
  }

  async update ({ id, ifAvailable, minLength, hash }) {
    const core = this._sessionState.getCore(id)
    return new Promise((resolve, reject) => {
      core.update({ ifAvailable, minLength, hash }, (err, block) => {
        if (err) return reject(err)
        return resolve({ block })
      })
    })
  }

  async seek ({ id, byteOffset, start, end, wait, ifAvailable }) {
    const core = this._sessionState.getCore(id)
    return new Promise((resolve, reject) => {
      core.seek(byteOffset, { start, end, wait, ifAvailable }, (err, seq, blockOffset) => {
        if (err) return reject(err)
        return resolve({ seq, blockOffset })
      })
    })
  }

  async has ({ id, seq }) {
    const core = this._sessionState.getCore(id)
    return new Promise((resolve, reject) => {
      core.ready(err => {
        if (err) return reject(err)
        return resolve({
          has: core.has(seq)
        })
      })
    })
  }

  async download ({ id, resourceId, start, end, blocks, linear }) {
    const core = this._sessionState.getCore(id)
    const opts = { start, end, blocks: blocks.length ? blocks : null, linear }
    return new Promise((resolve, reject) => {
      let downloaded = false
      const d = core.download(opts, (err) => {
        downloaded = true
        if (this._sessionState.hasResource(resourceId)) {
          this._sessionState.deleteResource(resourceId)
        }
        if (err) return reject(err)
        return resolve()
      })
      if (downloaded) return
      this._sessionState.addResource(resourceId, d, () => {
        core.undownload(d)
      })
      let downloadSet = this._downloads.get(id)
      if (!downloadSet) {
        downloadSet = new Set()
        this._downloads.set(id, downloadSet)
      }
      downloadSet.add(resourceId)
    })
  }

  async undownload ({ id, resourceId }) {
    // Loading the core just in case it's an invalid ID (it should throw in that case).
    this._sessionState.getCore(id)
    this._sessionState.deleteResource(resourceId)
    let downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    downloadSet.delete(resourceId)
    if (!downloadSet.size) this._downloads.delete(id)
  }
}
