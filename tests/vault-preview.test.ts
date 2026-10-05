import { describe, expect, it } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';
import {
  buildVaultOperationPreview,
  PocketPayError,
} from '../src';

const wallet = StellarSDK.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();

describe('vault operation preview', () => {
  it('builds a side-effect-free deposit preview with public review fields', () => {
    const preview = buildVaultOperationPreview(
      { operation: 'deposit', wallet, amount: '12.5' },
      { network: 'mainnet' },
    );

    expect(preview).toMatchObject({
      operation: 'deposit',
      wallet,
      amount: '12.5',
      asset: { code: 'XLM' },
      network: 'mainnet',
      estimatedFee: String(StellarSDK.BASE_FEE),
      supported: true,
    });
    expect(preview.warnings.join(' ')).toContain('does not imply native XLM custody');
    expect(JSON.stringify(preview)).not.toMatch(/secret|sourceSecret/i);
  });

  it('marks balance previews as read-only with no transaction fee', () => {
    const preview = buildVaultOperationPreview({ operation: 'getBalance', wallet });

    expect(preview.amount).toBeUndefined();
    expect(preview.estimatedFee).toBe('0');
    expect(preview.supported).toBe(true);
    expect(preview.warnings).toEqual([]);
  });

  it('previews lock intent without pretending the SDK can execute it', () => {
    const preview = buildVaultOperationPreview({
      operation: 'createLock',
      wallet,
      amount: '4',
    });

    expect(preview.supported).toBe(false);
    expect(preview.warnings.join(' ')).toContain(
      'current SDK does not execute vault lock operations',
    );
  });

  it('returns the SDK typed validation error for a malformed public key', () => {
    expect(() =>
      buildVaultOperationPreview({ operation: 'deposit', wallet: 'GINVALID', amount: '1' }),
    ).toThrow(PocketPayError);
  });

  it('returns the SDK typed validation error when a write preview has no amount', () => {
    expect(() =>
      buildVaultOperationPreview({ operation: 'withdraw', wallet }),
    ).toThrow(PocketPayError);
  });
});
