const os = require('os')

module.exports = function getSocketPath (name) {
  name = name || 'hyperspace'
  return os.platform() !== 'win32' ? `/tmp/${name}.sock` : `\\\\.\\pipe\\${name}`
}
