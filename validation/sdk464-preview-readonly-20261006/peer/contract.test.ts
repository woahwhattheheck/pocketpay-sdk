import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import * as Stellar from '@stellar/stellar-sdk';
const guard = createRequire(import.meta.url)('./network-deny.cjs');
const source = process.env.SDK464_SOURCE!;
const api = await import(source + '/src/index.ts');
const config = await import(source + '/src/config/index.ts');
const wallet = Stellar.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 31)).publicKey();
const sensitive = Stellar.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 32)).secret();
const sideEffects = { horizonServer: 0, fromSecret: 0, sign: 0, transactionBuild: 0 };
const nonDisclosure: Record<string, unknown>[] = [];
let spies: Record<string, any>;
function caught(params: any) {
  try { api.buildVaultOperationPreview(params); return undefined; }
  catch (error) { return error as any; }
}
beforeEach(() => {
  spies = {
    horizonServer: vi.spyOn(config, 'getHorizonServer').mockImplementation(() => { throw new Error('Preview attempted Horizon construction'); }),
    fromSecret: vi.spyOn(Stellar.Keypair, 'fromSecret').mockImplementation(() => { throw new Error('Preview attempted signing-secret access'); }),
    sign: vi.spyOn(Stellar.Keypair.prototype, 'sign').mockImplementation(() => { throw new Error('Preview attempted signing'); }),
    transactionBuild: vi.spyOn(Stellar.TransactionBuilder.prototype, 'build').mockImplementation(() => { throw new Error('Preview attempted transaction build'); }),
  };
});
afterEach(() => {
  for (const [name, spy] of Object.entries(spies)) {
    sideEffects[name as keyof typeof sideEffects] += spy.mock.calls.length;
    expect(spy.mock.calls.length).toBe(0);
  }
  vi.restoreAllMocks();
});
afterAll(() => {
  expect(Object.values(guard.counts).every((v) => v === 0)).toBe(true);
  writeFileSync(process.env.SDK464_CONTRACT_RECEIPT!, JSON.stringify({
    source, guardInstalledBeforeSubjectImport: true, networkCounts: guard.counts,
    sideEffectCalls: sideEffects, seedValuesWritten: false, nonDisclosure,
  }, null, 2) + '\n');
});
describe('independent public vault preview contract', () => {
  for (const operation of ['deposit', 'withdraw', 'createLock', 'getBalance'] as const) {
    it('models ' + operation + ' without signing, transaction build, servers, or network', () => {
      const preview = api.buildVaultOperationPreview({ operation, wallet, amount: '2.5' }, { network: 'mainnet' });
      expect(preview.operation).toBe(operation); expect(preview.wallet).toBe(wallet);
      expect(preview.asset).toEqual({ code: 'XLM' }); expect(preview.network).toBe('mainnet');
      expect(preview.supported).toBe(operation !== 'createLock');
      expect(preview.estimatedFee).toBe(operation === 'getBalance' ? '0' : String(Stellar.BASE_FEE));
      expect(preview.amount).toBe(operation === 'getBalance' ? undefined : '2.5');
      expect(preview.warnings.length).toBe(operation === 'getBalance' ? 0 : 2);
      const warning = preview.warnings.join(' ');
      expect(operation === 'getBalance' || warning.includes('resource fees')).toBe(true);
      expect(operation === 'createLock' ? warning.includes('does not execute')
        : operation === 'getBalance' || warning.includes('does not imply native XLM custody')).toBe(true);
    });
  }
  for (const [label, input] of [
    ['exact seed-shaped wallet', sensitive],
    ['trimmed seed-shaped wallet', ' \t' + sensitive + '\n'],
    ['seed-shaped wallet with invalid checksum', 'S' + 'A'.repeat(55)],
  ]) {
    it('rejects ' + label + ' with a typed non-disclosing error', () => {
      const error = caught({ operation: 'deposit', wallet: input, amount: '1' });
      const containsSeed = Boolean(error && (error.message.includes(input.trim()) || JSON.stringify(error).includes(input.trim())));
      nonDisclosure.push({ label, typedError: error instanceof api.PocketPayError,
        code: error?.code, reason: error?.validation?.reason, containsSeed });
      expect(error instanceof api.PocketPayError).toBe(true);
      expect(error.code).toBe('INVALID_PUBLIC_KEY');
      expect(containsSeed).toBe(false);
      expect(error.validation?.reason).toBe('secret_key_not_allowed');
      expect(Object.hasOwn(error.validation, 'value')).toBe(false);
    });
  }
  it('uses typed errors for unsupported runtime operation values', () => {
    for (const operation of [undefined, null, false, 2, {}, 'bad-operation']) {
      const error = caught({ operation, wallet, amount: '1' });
      expect(error instanceof api.PocketPayError).toBe(true);
      expect(error.code).toBe('INVALID_OPERATION');
      expect(error.validation.field).toBe('operation');
    }
  });
  it('uses shared typed errors for malformed public wallet inputs', () => {
    for (const input of [undefined, null, 7, '', 'GINVALID']) {
      const error = caught({ operation: 'deposit', wallet: input, amount: '1' });
      expect(error instanceof api.PocketPayError).toBe(true); expect(error.code).toBe('INVALID_PUBLIC_KEY');
    }
  });
  it('validates missing and malformed required amounts for every write intent', () => {
    for (const operation of ['deposit', 'withdraw', 'createLock']) {
      for (const amount of [undefined, null, '', '0', '-1', '1e3', '1.00000001']) {
        const error = caught({ operation, wallet, amount });
        expect(error instanceof api.PocketPayError).toBe(true);
        expect(['INVALID_AMOUNT', 'INVALID_AMOUNT_PRECISION'].includes(error.code)).toBe(true);
      }
    }
  });
  it('ignores optional balance amount and extra signing fields without copying them', () => {
    const preview = api.buildVaultOperationPreview({ operation: 'getBalance', wallet,
      amount: sensitive, sourceSecret: sensitive, secretKey: sensitive } as any);
    expect(preview.amount).toBeUndefined(); expect(JSON.stringify(preview).includes(sensitive)).toBe(false);
    expect(Object.hasOwn(preview, 'sourceSecret')).toBe(false);
    expect(Object.hasOwn(preview, 'secretKey')).toBe(false);
  });
  it('keeps warning arrays independent and the canonical shared XLM asset frozen', () => {
    const first = api.buildVaultOperationPreview({ operation: 'deposit', wallet, amount: '1' });
    const second = api.buildVaultOperationPreview({ operation: 'deposit', wallet, amount: '1' });
    first.warnings.length = 0; expect(second.warnings.length).toBe(2);
    expect(Object.isFrozen(first.asset)).toBe(true);
    expect(first.asset).toEqual({ code: 'XLM' });
  });
});
