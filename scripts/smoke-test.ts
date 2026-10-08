/**
 * Offline SDK package-consumer smoke check (#339).
 *
 * Intentionally resolves the package by its published name rather than
 * importing src/ or dist/ directly. This exercises package.json "exports"
 * and the compiled CommonJS entrypoint that consumers actually load.
 *
 * Run through `npm run test:smoke` (builds first). No Horizon/Friendbot/RPC
 * calls, real account funding, transaction submission or secret logging.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

function check(label: string, exercise: () => void): void {
  try {
    exercise();
  } catch {
    // AssertionErrors may contain secret material: report the check name only.
    throw new Error(`check failed: ${label}`);
  }
  console.log(`PASS ${label}`);
}

try {
  const entry = require.resolve('stellar-pocketpay-sdk');
  assert.match(entry.replace(/\\/g, '/'), /\/dist\/index\.js$/, 'package self-reference must resolve to built dist/index.js');
  const SDK = require('stellar-pocketpay-sdk');

  check('public package exports', () => {
    const publicHelpers = [
      'createWallet', 'importWallet', 'validatePublicKey', 'validateSecretKey',
      'createPaymentIntent', 'validatePaymentIntent', 'xlmToStroops',
      'resolveConfig', 'validateNetwork', 'classifySubmitError',
      'isUnknownStatusError',
    ];
    for (const name of publicHelpers) {
      assert.equal(typeof SDK[name], 'function', `missing public export ${name}`);
    }
    assert.equal(typeof SDK.PocketPayError, 'function');
    assert.equal(typeof SDK.NATIVE_ASSET, 'object');
    assert.equal(typeof SDK.ErrorCode, 'object');
  });

  let source!: { publicKey: string; secretKey: string };
  let destination!: { publicKey: string; secretKey: string };
  check('wallet creation, local import and rejected public-key-only import', () => {
    source = SDK.createWallet();
    destination = SDK.createWallet();
    assert.equal(SDK.validatePublicKey(source.publicKey), true);
    const restored = SDK.importWallet(source.secretKey);
    assert.equal(restored.publicKey, source.publicKey);
    assert.equal(restored.secretKey, source.secretKey);
    assert.throws(
      () => SDK.importWallet(source.publicKey),
      (error: unknown) => error instanceof SDK.PocketPayError &&
        (error as { code?: string }).code === 'INVALID_SECRET_KEY',
      'a public key must not be accepted as secret account material',
    );
  });

  check('offline native payment-intent lifecycle and invalid destination', () => {
    const valid = SDK.createPaymentIntent({
      source: source.publicKey,
      destination: destination.publicKey,
      amount: '1.5000000',
      asset: SDK.NATIVE_ASSET,
    });
    assert.equal(valid.status, 'valid');
    assert.equal(valid.assetState, 'supported');
    assert.equal(valid.validationResult?.valid, true);
    assert.equal(SDK.xlmToStroops('1.5'), 15_000_000);

    const invalid = SDK.createPaymentIntent({
      source: source.publicKey,
      destination: 'NOT_A_STELLAR_ADDRESS',
      amount: '1.5000000',
      asset: SDK.NATIVE_ASSET,
    });
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.validationResult?.valid, false);
  });

  check('explicit testnet configuration and typed validation error', () => {
    const config = SDK.resolveConfig({ network: 'testnet' });
    assert.equal(config.network, 'testnet');
    SDK.validateNetwork('testnet');
    assert.throws(
      () => SDK.validateNetwork('unsupported-network'),
      (error: unknown) => error instanceof SDK.PocketPayError &&
        (error as { code?: string }).code === 'INVALID_NETWORK',
    );
  });

  check('error classification and uncertain-submission handling', () => {
    const limited = SDK.classifySubmitError({ status: 429 });
    assert.ok(limited instanceof SDK.PocketPayError);
    assert.equal(limited.code, SDK.ErrorCode.NET_RATE_LIMITED);
    assert.equal(limited.retryable, true);

    const unknown = SDK.classifySubmitError({ code: 'ETIMEDOUT' });
    assert.equal(unknown.code, SDK.ErrorCode.TX_STATUS_UNKNOWN);
    assert.equal(SDK.isUnknownStatusError(unknown), true);
    assert.equal(unknown.retryable, false);
  });

  console.log('PocketPay package-consumer smoke passed (offline).');
} catch (error: unknown) {
  // Never print a possibly sensitive thrown object or wallet material.
  const kind = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`PocketPay package-consumer smoke FAILED (${kind}): ${message}`);
  process.exitCode = 1;
}
