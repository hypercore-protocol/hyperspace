function intoPeer (peer) {
  return {
    remotePublicKey: peer.remotePublicKey,
    remoteAddress: peer.remoteAddress,
    type: peer.type || peer.remoteType
  }
}

module.exports = {
  intoPeer
}
