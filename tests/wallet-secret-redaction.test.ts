/**
 * Issue #179: wallet secrets must not escape through SDK failure surfaces.
 * All key-shaped negative fixtures here are synthetic; no live key material.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWallet,
  enableDiagnostics,
  enhancedImportWallet,
  importWallet,
  PocketPayError,
  resetDiagnosticsHooks,
  safeImportWallet,
  signTransaction,
  type DiagnosticsEvent,
  type UnsignedTransaction,
} from '../src';
import { wrapError } from '../src/utils';

const syntheticKey = `S${'A'.repeat(55)}`;

afterEach(() => {
  resetDiagnosticsHooks();
});

describe('wallet secret redaction boundary (#179)', () => {
  it('sanitizes upstream errors and their attached causes before SDK callers log them', () => {
    const upstream = new Error(`Horizon rejected secret=${syntheticKey}`);
    upstream.name = `WalletError-${syntheticKey}`;
    upstream.stack = `original stack: ${syntheticKey}`;
    (upstream as Error & { metadata?: unknown }).metadata = { rawSecret: syntheticKey };

    const wrapped = wrapError(upstream, `Transaction failure ${syntheticKey}`, 'TX_FAILED');
    const exposed = [
      wrapped.message,
      wrapped.name,
      wrapped.cause?.message,
      wrapped.cause?.name,
      wrapped.cause?.stack,
      JSON.stringify(wrapped),
    ].join('\n');

    expect(wrapped).toBeInstanceOf(PocketPayError);
    expect(wrapped.code).toBe('TX_FAILED');
    expect(exposed).not.toContain(syntheticKey);
    expect(wrapped.cause).not.toBe(upstream);
    expect(wrapped.cause).not.toHaveProperty('metadata');
  });

  it('drops nested upstream causes rather than exposing a hidden wallet key', () => {
    const upstream = new Error('Remote signer failed') as Error & { cause?: unknown };
    upstream.cause = new Error(`secret: ${syntheticKey}`);
    const wrapped = wrapError(upstream, 'Signing failed', 'SIGNER_FAILED');

    expect(wrapped.message).toBe('Signing failed: Remote signer failed');
    expect(wrapped.cause?.message).toBe('Remote signer failed');
    expect(wrapped.cause).not.toHaveProperty('cause');
  });

  it('keeps invalid import results secret-free in direct and safe forms', () => {
    let thrown: PocketPayError | undefined;
    try {
      importWallet(syntheticKey);
    } catch (error) {
      thrown = error as PocketPayError;
    }
    expect(thrown).toBeInstanceOf(PocketPayError);
    expect(thrown?.message).not.toContain(syntheticKey);
    expect(thrown?.cause?.message ?? '').not.toContain(syntheticKey);

    const safe = safeImportWallet(syntheticKey);
    const enhanced = enhancedImportWallet(syntheticKey);
    expect(safe.ok).toBe(false);
    expect(enhanced.ok).toBe(false);
    if (!safe.ok && !enhanced.ok) {
      expect(JSON.stringify({ error: safe.error.message, validation: safe.error.validation })).not.toContain(syntheticKey);
      expect(JSON.stringify({ error: enhanced.error.message, hints: enhanced.recoveryHints })).not.toContain(syntheticKey);
    }
  });

  it('keeps signing mismatch errors and opt-in diagnostics free of wallet secrets', () => {
    const wallet = createWallet();
    const other = createWallet();
    const unsigned = { sourcePublicKey: other.publicKey } as UnsignedTransaction;

    expect(() => signTransaction(unsigned, wallet.secretKey)).toThrow(PocketPayError);
    try {
      signTransaction(unsigned, wallet.secretKey);
    } catch (error) {
      const failure = error as PocketPayError;
      expect(failure.code).toBe('KEY_MISMATCH');
      expect(failure.message).not.toContain(wallet.secretKey);
      expect(JSON.stringify(failure.validation)).not.toContain(wallet.secretKey);
    }

    const events: DiagnosticsEvent[] = [];
    enableDiagnostics({ hooks: { onEvent: (event) => events.push(event) } });
    const created = createWallet();
    const imported = importWallet(created.secretKey);
    expect(imported.publicKey).toBe(created.publicKey);
    expect(events.some((event) => event.type === 'wallet.created')).toBe(true);
    expect(events.some((event) => event.type === 'wallet.imported')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(created.secretKey);
    expect(JSON.stringify(events)).not.toContain(wallet.secretKey);
  });
});
