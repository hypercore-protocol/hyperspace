const hypertrie = require('hypertrie')
const { Header } = require('hypertrie/lib/messages')

module.exports = function startTrieExtension (corestore) {
  corestore.on('feed', function (feed) {
    onHeaderType(feed, function (type) {
      if (type !== 'hypertrie') return
      // fire up the trie to answer extensions, when the feed is gc'ed it'll be gc'ed
      hypertrie(null, null, { feed }).on('error', noop)
    })
  })
}

function onHeaderType (feed, ontype) {
  let finished = false
  feed.on('download', ondownload)
  get()

  function get () {
    feed.get(0, { wait: false }, function (err, data) {
      if (!err || finished) return
      feed.removeListener('download', ondownload)
      finished = true

      let type = null
      try {
        type = Header.decode(data).type
      } catch (_) {
        return ontype(null)
      }

      ontype(type)
    })
  }

  function ondownload (index) {
    if (index === 0) {
      feed.removeListener('download', ondownload)
      get()
    }
  }
}

function noop () {}
