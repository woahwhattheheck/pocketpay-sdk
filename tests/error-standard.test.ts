/**
 * Error standard tests (issue #260)
 * Verifies the public error code taxonomy: stable codes, categories, safe
 * messages, redaction of secrets, and retryability.
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorCategory,
  ErrorCode,
  ERROR_CODES,
  LEGACY_ERROR_CODE_ALIASES,
  isKnownErrorCode,
  resolveErrorCode,
  describeError,
  getErrorCategory,
  redactSensitive,
  redactError,
  isRetryableCode,
} from '../src/errors';
import { classifySubmitError } from '../src/errors';
import { PocketPayError } from '../src/types';

// Build a realistic Stellar-secret-shaped string at runtime so no static
// high-entropy literal is committed to the repo (avoids secret scanners).
const makeFakeKey = () =>
  'S' + 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.repeat(2).slice(0, 55);

describe('error code standard', () => {
  it('exposes a stable, non-empty registry', () => {
    const codes = Object.values(ErrorCode);
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      const spec = ERROR_CODES[code as keyof typeof ERROR_CODES];
      expect(spec).toBeDefined();
      expect(spec.category).toBeTruthy();
      expect(typeof spec.retryable).toBe('boolean');
      expect(spec.safeMessage).toBeTruthy();
      expect(spec.developerHint).toBeTruthy();
    }
  });

  it('classifies codes into the expected categories', () => {
    expect(getErrorCategory(ErrorCode.WALLET_SECRET_EXPOSED)).toBe(ErrorCategory.Wallet);
    expect(getErrorCategory(ErrorCode.PAYMENT_SELF)).toBe(ErrorCategory.Payment);
    expect(getErrorCategory(ErrorCode.TX_EXPIRED)).toBe(ErrorCategory.Transaction);
    expect(getErrorCategory(ErrorCode.NET_RATE_LIMITED)).toBe(ErrorCategory.Network);
    expect(getErrorCategory(ErrorCode.SOROBAN_CONTRACT_ERROR)).toBe(ErrorCategory.Soroban);
    expect(getErrorCategory(ErrorCode.VAULT_DEPOSIT_FAILED)).toBe(ErrorCategory.Vault);
  });

  it('reports retryability per the standard', () => {
    expect(isRetryableCode(ErrorCode.NET_RATE_LIMITED)).toBe(true);
    expect(isRetryableCode(ErrorCode.NET_TIMEOUT)).toBe(true);
    expect(isRetryableCode(ErrorCode.TX_EXPIRED)).toBe(false);
    expect(isRetryableCode(ErrorCode.PAYMENT_SELF)).toBe(false);
  });

  it('safe messages never contain secret keys', () => {
    for (const code of Object.values(ErrorCode)) {
      const spec = ERROR_CODES[code as keyof typeof ERROR_CODES];
      expect(spec.safeMessage).not.toMatch(/[S][A-Za-z0-9]{10,}/);
    }
  });

  it('describeError returns SDK defaults for unknown codes', () => {
    const d = describeError('TOTALLY_UNKNOWN');
    expect(d.known).toBe(false);
    expect(d.category).toBe(ErrorCategory.SDK);
    expect(d.safeMessage).toBeTruthy();
  });

  it('isKnownErrorCode discriminates known vs unknown', () => {
    expect(isKnownErrorCode(ErrorCode.VAULT_WITHDRAW_FAILED)).toBe(true);
    expect(isKnownErrorCode('NOPE')).toBe(false);
  });

  it('normalizes legacy module error strings to stable canonical codes', () => {
    const representative = {
      // wallet / account
      INVALID_SECRET_KEY: ErrorCode.WALLET_INVALID_SECRET,
      INVALID_PUBLIC_KEY: ErrorCode.WALLET_INVALID_PUBLIC_KEY,
      ACCOUNT_NOT_FOUND: ErrorCode.WALLET_ACCOUNT_UNFUNDED,
      // payments / transactions
      INVALID_AMOUNT: ErrorCode.PAYMENT_INVALID_AMOUNT,
      SELF_PAYMENT: ErrorCode.PAYMENT_SELF,
      PAYMENT_FAILED: ErrorCode.TX_FAILED,
      // network / config
      HORIZON_ERROR: ErrorCode.NET_UNREACHABLE,
      INVALID_NETWORK: ErrorCode.SDK_CONFIG_INVALID,
      // Soroban / vault
      CONTRACT_INVOKE_ERROR: ErrorCode.SOROBAN_CONTRACT_ERROR,
      VAULT_DEPOSIT_ERROR: ErrorCode.VAULT_DEPOSIT_FAILED,
    } as const;

    for (const [legacy, canonical] of Object.entries(representative)) {
      expect(LEGACY_ERROR_CODE_ALIASES[legacy]).toBe(canonical);
      expect(resolveErrorCode(legacy)).toBe(canonical);

      const description = describeError(legacy);
      expect(description.known).toBe(true);
      expect(description.legacyAlias).toBe(true);
      expect(description.canonicalCode).toBe(canonical);
      expect(description.safeMessage).toBe(ERROR_CODES[canonical].safeMessage);
    }

    expect(resolveErrorCode('HTTP_ERROR_503')).toBe(ErrorCode.NET_HTTP);
    expect(resolveErrorCode('TX_STATUS_NOT_FOUND')).toBe(ErrorCode.TX_STATUS_UNKNOWN);
  });

  it('returns SDK_INTERNAL metadata for truly unknown codes', () => {
    const d = describeError('TOTALLY_UNKNOWN');
    expect(d.known).toBe(false);
    expect(d.legacyAlias).toBe(false);
    expect(d.canonicalCode).toBe(ErrorCode.SDK_INTERNAL);
    expect(d.category).toBe(ErrorCategory.SDK);
    expect(d.safeMessage).toBe(ERROR_CODES[ErrorCode.SDK_INTERNAL].safeMessage);
  });
});

describe('redaction', () => {
  it('redacts Stellar secret keys', () => {
    const fakeKey = makeFakeKey();
    const redacted = redactSensitive(`secret is ${fakeKey} done`);
    expect(redacted).not.toContain(fakeKey);
    expect(redacted).toContain('[REDACTED_SECRET]');
  });

  it('redactError strips secrets from a PocketPayError message', () => {
    const fakeKey = makeFakeKey();
    const err = new PocketPayError(`leaked ${fakeKey}`, ErrorCode.SDK_INTERNAL);
    const safe = redactError(err);
    expect(safe.message).not.toContain(fakeKey);
    expect(safe.code).toBe(ErrorCode.SDK_INTERNAL);
    expect(safe.canonicalCode).toBe(ErrorCode.SDK_INTERNAL);
    expect(safe.safeMessage).toBeTruthy();
  });

  it('redactError works on non-PocketPayError values', () => {
    const fakeKey = makeFakeKey();
    const safe = redactError(new Error(`oops ${fakeKey}`));
    expect(safe.message).not.toContain(fakeKey);
    expect(safe.category).toBe(ErrorCategory.SDK);
  });
});

describe('classifySubmitError taxonomy wiring', () => {
  it('maps a 429 to NET_RATE_LIMITED and marks it retryable', () => {
    const err = classifySubmitError({ response: { status: 429 } });
    expect(err.code).toBe(ErrorCode.NET_RATE_LIMITED);
    expect(err.category).toBe(ErrorCategory.Network);
    expect(err.retryable).toBe(true);
    expect(err.safeMessage).toBeTruthy();
  });

  it('maps a timeout to TX_STATUS_UNKNOWN', () => {
    const err = classifySubmitError({ code: 'ETIMEDOUT' }, 'abc');
    expect(err.code).toBe(ErrorCode.TX_STATUS_UNKNOWN);
    expect(err.category).toBe(ErrorCategory.Transaction);
  });

  it('redacts secrets leaking from raw submission errors', () => {
    const fakeKey = makeFakeKey();
    const err = classifySubmitError(new Error(`boom ${fakeKey}`));
    expect(err.message).not.toContain(fakeKey);
  });
});
