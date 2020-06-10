module.exports = class Sessions {
  constructor () {
    this._liveSessions = []
    this._freeSessions = []
  }
  get (idx) {
    return this._liveSessions[idx]
  }
  insert (value) {
    this._freeSessions.length ? 
  }
}
