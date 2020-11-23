const LOCK = Symbol('hypercore lock')

module.exports = class HypercoreSession {
  constructor (client, sessionState) {
    this._client = client
    this._sessionState = sessionState
    this._downloads = new Map()
  }

  // RPC Methods

  close ({ id }) {
    this._sessionState.deleteCore(id)
    this._sessionState.deleteResource('@hypercore/append-' + id)
    this._sessionState.deleteResource('@hypercore/peer-open-' + id)
    this._sessionState.deleteResource('@hypercore/peer-remove-' + id)
    if (this._sessionState.hasResource('@hypercore/close-' + id)) {
      this._sessionState.deleteResource('@hypercore/close-' + id)
    }
    if (this._sessionState.hasResource('@hypercore/download-' + id)) {
      this._sessionState.deleteResource('@hypercore/download-' + id)
    }
    if (this._sessionState.hasResource('@hypercore/upload-' + id)) {
      this._sessionState.deleteResource('@hypercore/upload-' + id)
    }
    const downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    for (const resourceId of downloadSet) {
      this._sessionState.deleteResource(resourceId)
    }
    this._downloads.delete(id)
  }

  async get ({ id, resourceId, seq, wait, ifAvailable, onWaitId }) {
    const core = this._sessionState.getCore(id)
    const onwait = onWaitId ? seq => this._client.hypercore.onWaitNoReply({ id, onWaitId, seq }) : null

    return new Promise((resolve, reject) => {
      const get = core.get(seq, { wait, ifAvailable, onwait }, (err, block) => {
        if (this._sessionState.hasResource(resourceId)) this._sessionState.deleteResource(resourceId, true)
        if (err) return reject(err)
        return resolve({ block })
      })
      this._sessionState.addResource(resourceId, get, () => core.cancel(get))
    })
  }

  cancel ({ id, resourceId }) {
    this._sessionState.getCore(id) // make sure it exists
    if (this._sessionState.hasResource(resourceId)) {
      this._sessionState.deleteResource(resourceId)
    }
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

  async download ({ id, resourceId, start, end, blocks, linear, live }) {
    const core = this._sessionState.getCore(id)
    const opts = { start, end: live ? -1 : end, blocks: blocks.length ? blocks : null, linear }
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

  undownload ({ id, resourceId }) {
    // Loading the core just in case it's an invalid ID (it should throw in that case).
    this._sessionState.getCore(id)
    if (this._sessionState.hasResource(resourceId)) {
      this._sessionState.deleteResource(resourceId)
    }
    const downloadSet = this._downloads.get(id)
    if (!downloadSet) return
    downloadSet.delete(resourceId)
    if (!downloadSet.size) this._downloads.delete(id)
  }

  registerExtension ({ id, resourceId, name }) {
    const core = this._sessionState.getCore(id)
    const client = this._client

    core.extensions.exclusive = false

    const ext = core.registerExtension(name, {
      onmessage (data, from) {
        client.hypercore.onExtensionNoReply({
          id: id,
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

  sendExtension ({ id, resourceId, remotePublicKey, data }) {
    const core = this._sessionState.getCore(id)
    const ext = this._sessionState.getResource(resourceId)

    if (!remotePublicKey) {
      ext.broadcast(data)
      return
    }

    for (const peer of core.peers) {
      if (peer.remotePublicKey && peer.remotePublicKey.equals(remotePublicKey)) {
        ext.send(data, peer)
      }
    }
  }

  downloaded ({ id, start, end }) {
    const core = this._sessionState.getCore(id)
    const bytes = core.downloaded(start, end)
    return { bytes }
  }

  async acquireLock ({ id }) {
    const core = this._sessionState.getCore(id)

    while (true) {
      const lock = core[LOCK]
      if (!lock) break
      await lock.promise
    }

    const lock = core[LOCK] = {
      promise: null,
      resolve: null,
      session: this
    }

    lock.promise = new Promise((resolve, reject) => {
      lock.resolve = resolve
    })

    this._sessionState.addResource(LOCK, null, () => lock.resolve())
  }

  releaseLock ({ id }) {
    const core = this._sessionState.getCore(id)
    const lock = core[LOCK]

    if (!lock) throw new Error('Core is not locked')
    if (lock.session !== this) throw new Error('Core is not locked by you')

    core[LOCK] = null
    this._sessionState.deleteResource(LOCK)
  }

  async watchDownloads ({ id }) {
    if (this._sessionState.hasResource('@hypercore/download-' + id)) {
      return
    }
    const core = this._sessionState.getCore(id)
    const downloadListener = (seq, data) => {
      this._client.hypercore.onDownloadNoReply({
        id,
        seq,
        byteLength: data.length
      })
    }
    core.on('download', downloadListener)
    this._sessionState.addResource('@hypercore/download-' + id, null, () => {
      core.removeListener('download', downloadListener)
    })
  }

  async unwatchDownloads ({ id }) {
    if (this._sessionState.hasResource('@hypercore/download-' + id)) {
      this._sessionState.deleteResource('@hypercore/download-' + id)
    }
  }

  async watchUploads ({ id }) {
    if (this._sessionState.hasResource('@hypercore/upload-' + id)) {
      return
    }
    const core = this._sessionState.getCore(id)
    const uploadListener = (seq, data) => {
      this._client.hypercore.onUploadNoReply({
        id,
        seq,
        byteLength: data.length
      })
    }
    core.on('upload', uploadListener)
    this._sessionState.addResource('@hypercore/upload-' + id, null, () => {
      core.removeListener('upload', uploadListener)
    })
  }

  async unwatchUploads ({ id }) {
    if (this._sessionState.hasResource('@hypercore/upload-' + id)) {
      this._sessionState.deleteResource('@hypercore/upload-' + id)
    }
  }
}
