import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getNetworkPassphrase,
  resolveConfig,
  validatePocketPayConfig,
} from '../src';

function expectConfigError(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected configuration error ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('network configuration preset boundaries', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_HORIZON_URL;
    delete process.env.STELLAR_SOROBAN_RPC_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects an explicit null passphrase instead of silently using a preset', () => {
    expectConfigError(
      () =>
        resolveConfig({
          network: 'testnet',
          networkPassphrase: null as unknown as string,
        }),
      'INVALID_NETWORK_PASSPHRASE'
    );

    expect(
      validatePocketPayConfig({
        network: 'testnet',
        networkPassphrase: null,
      })
    ).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          field: 'networkPassphrase',
          code: 'INVALID_NETWORK_PASSPHRASE',
        }),
      ]),
    });
  });

  it('rejects URL schemes that merely begin with http', () => {
    expectConfigError(
      () => resolveConfig({ horizonUrl: 'httpx://horizon.example.com' }),
      'INVALID_HORIZON_URL'
    );

    expectConfigError(
      () => resolveConfig({ sorobanRpcUrl: 'httpsx://rpc.example.com' }),
      'INVALID_SOROBAN_RPC_URL'
    );

    const result = validatePocketPayConfig({
      horizonUrl: 'httpx://horizon.example.com',
      sorobanRpcUrl: 'httpsx://rpc.example.com',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'horizonUrl',
          code: 'INVALID_HORIZON_URL',
        }),
        expect.objectContaining({
          field: 'sorobanRpcUrl',
          code: 'INVALID_SOROBAN_RPC_URL',
        }),
      ])
    );
    expect(result.config).toBeUndefined();
  });

  it('preserves a valid explicit passphrase and its override source', () => {
    const config = resolveConfig({
      network: 'mainnet',
      networkPassphrase: getNetworkPassphrase('mainnet'),
    });

    expect(config.networkPassphrase).toBe(getNetworkPassphrase('mainnet'));
    expect(config.sources.networkPassphrase).toBe('override');
  });
});
