# hyperspace
[![Build Status](https://travis-ci.com/andrewosh/hyperspace.svg?token=WgJmQm3Kc6qzq1pzYrkx&branch=master)](https://travis-ci.com/andrewosh/hyperspace)

> Hypercores, batteries included.

Hyperspace is a lightweight server that provides remote access to Hypercores and a Hyperswarm instance. It exposes a simple [RPC interface](https://github.com/hyperspace-org/rpc) that can be accessed with the [Hyperspace client for Node.js](https://github.com/hyperspace-org/client).

The RPC API's designed to be minimal, maintaining parity with Hypercore and the [`@corestore/networker`](https://github.com/andrewosh/corestore-networker) but with few extras.

Features include:
* A `RemoteCorestore` interface for creating namespaced [`Corestore`](https://github.com/andrewosh/corestore) instances. 
* A `RemoteNetworker` interface for managing [Hyperswarm DHT](https://github.com/hyperswarm/hyperswarm) connections. Supports stream-level extensions. 
* A `RemoteHypercore` interface that feels exactly like normal ol' [`Hypercore`](https://github.com/hypercore-protocol/hypercore), with [few exceptions](TODO). Extensions included.

#### Already using the Hyperdrive daemon?
With Hyperspace, most of the [Hyperdrive daemon's](https://github.com/hypercore-protocol/hyperdrive-daemon) functionality has been moved into "userland" -- instead of providing remote access to Hyperdrives, the regular [`hyperdrive`](https://github.com/hypercore-protocol/hyperdrive) module can be used with remote Hypercores.

If you're currently using the Hyperdrive daemon with FUSE and/or the daemon CLI, take a look at the upgrade instructions in [`@hyperspace/hyperdrive`](https://github.com/hyperspace-org/hyperdrive-service), which is our new Hyperdrive companion service for handling FUSE/CLI alongside Hyperspace.

__Note: The first time you run Hyperspace, it will detect your old Hyperdrive daemon installation and do an automatic migration. You can postpone the migration by starting the server with the `--no-migrate` flag (`hyperspace --no-migrate`).__

### Installation
```
npm i hyperspace -g
```

### Getting Started
When installed globally, you can use the `hyperspace` CLI tool to start the server:
```
❯ hyperspace --no-migrate  // Starts the server without performing the Hyperdrive daemon migration
```

The `hyperspace` command supports the following flags:
```
--bootstrap   // Hyperswarm bootstrapping options (see Hyperswarm docs).
--host        // Host to bind to.
--port        // Port to bind to (if specified, will use TCP).
--memory-only // Run in memory-only mode.
--no-announce // Never announce topics on the DHT.
--no-migrate  // Do not attempt to migrate the Hyperdrive daemon's storage to Hyperspace.
--repl        // Start the server with a debugging REPL.
```

By default, Hyperspace binds to a UNIX domain socket (or named pipe on Windows) at `~/.hyperspace/hyperspace.sock`.

Once the server's started, you can use the client to create and manage remote Hypercores. If you'd like the use the Hyperdrive CLI, check out the [`@hyperspace/hyperdrive` docs](https://github.com/hyperspace-org/hyperdrive-service).

### API
To work with Hyperspace, you'll probably want to start with the [Node.js client library](https://github.com/hyperspace-org/client). The README over there provides detailed API info.

### Simulator

Hyperspace includes a "simulator" that can be used to create one-off Hyperspace instances, which can be used for testing.

```js
const simulator = require('hyperspace/simulator')
// client is a HyperspaceClient, server is a HyperspaceServer
const { client, server, cleanup } = await simulator()
```

### License
MIT
