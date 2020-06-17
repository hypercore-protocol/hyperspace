const os = require('os')
const p = require('path')
const Hyperspace = require('./server')

const hypercoreStorage = require('hypercore-default-storage')
const DAEMON_STORAGE = p.join(os.homedir(), '.hyperdrive', 'storage', 'cores')

const server = new Hyperspace({
  storage: path => hypercoreStorage(p.join(DAEMON_STORAGE, path))
})
server.ready()
