'use strict';

const fs = require('node:fs');
const path = require('node:path');
const counts = { socketConnect: 0, tlsConnect: 0, httpRequest: 0, httpsRequest: 0, fetch: 0, udpSend: 0 };
function deny(kind) {
  counts[kind] += 1;
  throw new Error('SDK333 validation blocked an unmocked network transport: ' + kind);
}
require('node:net').Socket.prototype.connect = function () { return deny('socketConnect'); };
require('node:tls').connect = function () { return deny('tlsConnect'); };
for (const name of ['node:http', 'node:https']) {
  const kind = name === 'node:http' ? 'httpRequest' : 'httpsRequest';
  const mod = require(name);
  mod.request = function () { return deny(kind); };
  mod.get = function () { return deny(kind); };
}
require('node:dgram').Socket.prototype.send = function () { return deny('udpSend'); };
globalThis.fetch = function () { return deny('fetch'); };
globalThis.__SDK333_NETWORK_GUARD__ = {
  counts,
  socketConnect: require('node:net').Socket.prototype.connect,
  tlsConnect: require('node:tls').connect,
  httpRequest: require('node:http').request,
  httpsRequest: require('node:https').request,
  fetch: globalThis.fetch,
  udpSend: require('node:dgram').Socket.prototype.send,
};
process.on('exit', () => {
  const dir = process.env.SDK333_GUARD_RECEIPT_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, process.pid + '.json'), JSON.stringify({ pid: process.pid, counts }) + '\n');
  }
});
