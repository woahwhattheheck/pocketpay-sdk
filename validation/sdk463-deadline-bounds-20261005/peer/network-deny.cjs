'use strict';
const counts = { socketConnect: 0, tlsConnect: 0, httpRequest: 0, httpsRequest: 0, fetch: 0, udpSend: 0 };
function deny(kind) {
  counts[kind] += 1;
  throw new Error('Independent SDK333 peer blocked network transport: ' + kind);
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
module.exports = { loaded: true, counts };
