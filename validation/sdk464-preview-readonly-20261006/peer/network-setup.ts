import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, expect } from 'vitest';
const require = createRequire(import.meta.url);
const guard = require('./network-deny.cjs');
if (!guard.loaded || require('node:net').Socket.prototype.connect !== guard.fns.socketConnect ||
    require('node:tls').connect !== guard.fns.tlsConnect ||
    require('node:http').request !== guard.fns.httpRequest ||
    require('node:https').request !== guard.fns.httpsRequest ||
    globalThis.fetch !== guard.fns.fetch || require('node:dgram').Socket.prototype.send !== guard.fns.udpSend) {
  throw new Error('SDK464 peer worker network guard not installed before SDK imports');
}
afterAll(() => {
  const path = process.env.SDK464_GUARD_DIR!; mkdirSync(path, { recursive: true });
  writeFileSync(join(path, basename(expect.getState().testPath || 'unknown') + '.json'),
    JSON.stringify({ guardInstalledBeforeSubjectImport: true, counts: guard.counts }) + '\n');
});
