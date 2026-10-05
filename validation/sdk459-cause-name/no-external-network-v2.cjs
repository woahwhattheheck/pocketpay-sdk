// Validation-only transport guard, including Node's normalized connect arguments.
const net = require('node:net');
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const params = Array.isArray(args[0]) ? args[0] : args;
  const first = params[0];
  if (typeof first === 'string' && !/^\d+$/.test(first)) return originalConnect.apply(this, args);
  const opts = first && typeof first === 'object' ? first : { host: typeof params[1] === 'string' ? params[1] : 'localhost' };
  if (opts.path) return originalConnect.apply(this, args);
  const host = opts.host || 'localhost';
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    const error = new Error('Validation blocked external network transport');
    error.code = 'SDK_VALIDATION_EXTERNAL_NETWORK_BLOCKED';
    throw error;
  }
  return originalConnect.apply(this, args);
};
