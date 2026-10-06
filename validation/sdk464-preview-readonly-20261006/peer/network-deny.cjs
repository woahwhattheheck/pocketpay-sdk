'use strict';
const counts = { socketConnect: 0, tlsConnect: 0, httpRequest: 0, httpsRequest: 0, fetch: 0, udpSend: 0 };
function deny(kind) { counts[kind]++; throw new Error('SDK464 peer blocked network transport: ' + kind); }
const fns = {
  socketConnect: function () { return deny('socketConnect'); },
  tlsConnect: function () { return deny('tlsConnect'); },
  httpRequest: function () { return deny('httpRequest'); },
  httpsRequest: function () { return deny('httpsRequest'); },
  fetch: function () { return deny('fetch'); },
  udpSend: function () { return deny('udpSend'); },
};
require('node:net').Socket.prototype.connect = fns.socketConnect;
require('node:tls').connect = fns.tlsConnect;
for (const name of ['node:http', 'node:https']) {
  const fn = name === 'node:http' ? fns.httpRequest : fns.httpsRequest;
  require(name).request = fn; require(name).get = fn;
}
require('node:dgram').Socket.prototype.send = fns.udpSend;
globalThis.fetch = fns.fetch;
module.exports = { loaded: true, counts, fns };
