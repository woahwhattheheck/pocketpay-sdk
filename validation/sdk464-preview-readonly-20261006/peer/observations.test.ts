import { afterAll, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as Stellar from '@stellar/stellar-sdk';
const api = await import(process.env.SDK464_SOURCE! + '/src/index.ts');
const wallet = Stellar.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 41)).publicKey();
const sensitive = Stellar.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42)).secret();
const records: Record<string, unknown>[] = [];
for (const [label, params] of [
  ['decorated wallet string', { operation: 'deposit', wallet: 'label: ' + sensitive, amount: '1' }],
  ['misplaced required amount string', { operation: 'withdraw', wallet, amount: sensitive }],
  ['misplaced unsupported operation string', { operation: sensitive, wallet, amount: '1' }],
] as const) {
  it('records the current typed-error disclosure boundary for ' + label + ' without printing values', () => {
    let error: any;
    try { api.buildVaultOperationPreview(params as any); } catch (caught) { error = caught; }
    expect(error instanceof api.PocketPayError).toBe(true);
    records.push({ label, typedError: true, code: error.code,
      seedInMessage: error.message.includes(sensitive),
      seedInSerializedError: JSON.stringify(error).includes(sensitive),
      seedInValidationValue: JSON.stringify(error.validation?.value).includes(sensitive),
      sourceValuesWritten: false });
  });
}
it('compares null-params handling with the unchanged existing payment-preview entry', async () => {
  let vaultError: any, paymentError: any;
  try { api.buildVaultOperationPreview(null as any); } catch (error) { vaultError = error; }
  try { await api.previewPayment(null as any); } catch (error) { paymentError = error; }
  records.push({ label: 'null-params acceptance pattern',
    vaultTypedError: vaultError instanceof api.PocketPayError,
    paymentTypedError: paymentError instanceof api.PocketPayError,
    vaultTypeError: vaultError instanceof TypeError, paymentTypeError: paymentError instanceof TypeError });
  expect(vaultError instanceof TypeError).toBe(true); expect(paymentError instanceof TypeError).toBe(true);
});
afterAll(() => writeFileSync(process.env.SDK464_OBSERVATIONS_RECEIPT!, JSON.stringify({
  note: 'Diagnostic observations, not claims that arbitrary misplaced secrets are covered by the exact-wallet guard.',
  seedValuesWritten: false, records,
}, null, 2) + '\n'));
