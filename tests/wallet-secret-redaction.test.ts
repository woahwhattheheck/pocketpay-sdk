import { describe, expect, it } from 'vitest';
import { importWallet, safeImportWallet } from '../src/wallet';
import { signTransaction } from '../src/transactions/offline-preparation';
import { PocketPayError } from '../src/types';
import { toResult } from '../src/utils';

// Built at runtime so the repository never contains usable signing material.
// It has the shape of a Stellar secret key but an intentionally invalid checksum.
const makeSyntheticSecret = (): string =>
  `S${'ABCDEFGHJKLMNPQRSTUVWXYZ234567'.repeat(2).slice(0, 55)}`;

function expectSecretAbsent(error: PocketPayError, secret: string): void {
  const exposedText = [
    error.message,
    error.stack,
    error.cause?.message,
    error.cause?.stack,
    JSON.stringify(error),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  expect(exposedText).not.toContain(secret);
}

describe('wallet secret redaction boundaries', () => {
  it('does not expose a rejected import secret in thrown errors', () => {
    const secret = makeSyntheticSecret();

    try {
      importWallet(secret);
      expect.fail('expected importWallet to reject the synthetic secret');
    } catch (error) {
      expect(error).toBeInstanceOf(PocketPayError);
      const pocketError = error as PocketPayError;
      expectSecretAbsent(pocketError, secret);
      expect(pocketError.validation?.value).toBeUndefined();
    }
  });

  it('does not expose a rejected import secret in safe-result metadata', () => {
    const secret = makeSyntheticSecret();
    const result = safeImportWallet(secret);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectSecretAbsent(result.error, secret);
      expect(result.error.validation?.value).toBeUndefined();
    }
  });

  it('does not expose a rejected signing secret', () => {
    const secret = makeSyntheticSecret();

    try {
      // Secret validation runs before the unsigned transaction is inspected.
      signTransaction({} as never, secret);
      expect.fail('expected signTransaction to reject the synthetic secret');
    } catch (error) {
      expect(error).toBeInstanceOf(PocketPayError);
      expectSecretAbsent(error as PocketPayError, secret);
    }
  });

  it('redacts transaction failure messages, stacks, and returned causes', async () => {
    const secret = makeSyntheticSecret();
    const raw = new Error(`Horizon rejected transaction for ${secret}`);
    raw.stack = `Error: Horizon rejected transaction for ${secret}`;

    const result = await toResult(
      async () => Promise.reject(raw),
      'Failed to submit transaction',
      'TX_SUBMISSION_ERROR',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectSecretAbsent(result.error, secret);
      expect(result.error.cause).toBeInstanceOf(Error);
      expect(result.error.cause).not.toBe(raw);
    }
  });
});
