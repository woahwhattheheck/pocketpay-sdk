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
      unlockAt: 1_900_000_000,
    });

    expect(preview.supported).toBe(false);
    expect(preview.unlockAt).toBe(1_900_000_000);
    expect(preview.warnings.join(' ')).toContain(
      'current SDK does not execute vault lock operations',
    );
  });

  it('rejects a lock preview that omits its unlock time', () => {
    let thrown: unknown;
    try {
      buildVaultOperationPreview({
        operation: 'createLock',
        wallet,
        amount: '4',
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PocketPayError);
    expect(thrown).toMatchObject({
      code: 'INVALID_OPERATION',
      validation: {
        field: 'unlockAt',
        reason: 'missing',
      },
    });
  });

  it('returns a typed validation error for an unknown runtime operation', () => {
    let thrown: unknown;
    try {
      buildVaultOperationPreview({
        operation: 'not-a-vault-operation' as never,
        wallet,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PocketPayError);
    expect(thrown).toMatchObject({
      code: 'INVALID_OPERATION',
      validation: {
        field: 'operation',
        reason: 'unsupported_value',
        value: 'not-a-vault-operation',
      },
    });
  });

  it('returns the SDK typed validation error for a malformed public key', () => {
    expect(() =>
      buildVaultOperationPreview({ operation: 'deposit', wallet: 'GINVALID', amount: '1' }),
    ).toThrow(PocketPayError);
  });

  it('rejects secret-like wallet input without echoing it in the typed error', () => {
    const secret = StellarSDK.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).secret();
    const malformedSecret = `S${'A'.repeat(54)}`;

    for (const secretLike of [secret, malformedSecret]) {
      let thrown: unknown;

      try {
        buildVaultOperationPreview({
          operation: 'deposit',
          wallet: secretLike,
          amount: '1',
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(PocketPayError);
      expect(thrown).toMatchObject({
        code: 'INVALID_PUBLIC_KEY',
        validation: {
          field: 'publicKey',
          reason: 'secret_key_not_allowed',
        },
      });
      expect((thrown as PocketPayError).validation).not.toHaveProperty('value');
      expect((thrown as Error).message).not.toContain(secretLike);
      expect(JSON.stringify(thrown)).not.toContain(secretLike);
    }
  });

  it('returns the SDK typed validation error when a write preview has no amount', () => {
    expect(() =>
      buildVaultOperationPreview({ operation: 'withdraw', wallet } as never),
    ).toThrow(PocketPayError);
  });
});
