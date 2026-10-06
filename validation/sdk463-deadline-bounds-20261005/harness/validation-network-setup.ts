import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, expect } from 'vitest';

const require = createRequire(import.meta.url);
require('./validation-network-deny.cjs');
const guard = (globalThis as any).__SDK333_NETWORK_GUARD__;
if (!guard || require('node:net').Socket.prototype.connect !== guard.socketConnect ||
    require('node:tls').connect !== guard.tlsConnect ||
    require('node:http').request !== guard.httpRequest ||
    require('node:https').request !== guard.httpsRequest ||
    globalThis.fetch !== guard.fetch || require('node:dgram').Socket.prototype.send !== guard.udpSend) {
  throw new Error('SDK333 validation network guard is not installed in the test worker');
}

afterAll(() => {
  const dir = process.env.SDK333_GUARD_RECEIPT_DIR;
  if (!dir) throw new Error('SDK333 validation guard receipt directory is missing');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'worker-' + basename(expect.getState().testPath || 'unknown') + '.json'),
    JSON.stringify({ pid: process.pid, workerGuardInstalled: true, counts: guard.counts }) + '\n');
});
