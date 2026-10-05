import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diagnoseTestnetAccount,
  resetHorizonServerFactory,
  setHorizonServerFactory,
} from '../src';
import { testnetAccountFixtures } from './fixtures/testnet-accounts';

describe('diagnoseTestnetAccount', () => {
  afterEach(() => {
    resetHorizonServerFactory();
  });

  it('maps a funded Testnet lookup to a funded diagnostic', async () => {
    const lookup = vi.fn(async () => testnetAccountFixtures.funded.result);

    const result = await diagnoseTestnetAccount(
      testnetAccountFixtures.funded.publicKey,
      { lookup },
    );

    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(testnetAccountFixtures.funded.publicKey);
    expect(result).toEqual({
      publicKey: testnetAccountFixtures.funded.publicKey,
      network: 'testnet',
      testnetOnly: true,
      status: 'funded',
      balance: testnetAccountFixtures.funded.result.balance,
    });
  });

  it('maps an unfunded Testnet lookup without treating it as an error', async () => {
    const result = await diagnoseTestnetAccount(
      testnetAccountFixtures.unfunded.publicKey,
      { lookup: async () => testnetAccountFixtures.unfunded.result },
    );

    expect(result).toEqual({
      publicKey: testnetAccountFixtures.unfunded.publicKey,
      network: 'testnet',
      testnetOnly: true,
      status: 'unfunded',
    });
  });

  it('maps lookup failures to a stable unavailable diagnostic without leaking raw errors', async () => {
    const result = await diagnoseTestnetAccount(
      testnetAccountFixtures.funded.publicKey,
      {
        lookup: async () => {
          throw new Error('provider detail that should not escape');
        },
      },
    );

    expect(result).toEqual({
      publicKey: testnetAccountFixtures.funded.publicKey,
      network: 'testnet',
      testnetOnly: true,
      status: 'unavailable',
      message: 'Testnet account state could not be determined.',
    });
    expect(JSON.stringify(result)).not.toContain('provider detail');
  });

  it('preserves a typed error code while keeping the unavailable message safe', async () => {
    const result = await diagnoseTestnetAccount(
      testnetAccountFixtures.funded.publicKey,
      {
        lookup: async () => {
          throw Object.assign(new Error('internal endpoint failure'), {
            code: 'NET_UNREACHABLE',
          });
        },
      },
    );

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.errorCode).toBe('NET_UNREACHABLE');
      expect(result.message).not.toContain('internal endpoint');
    }
  });

  it('rejects malformed public keys before invoking a lookup', async () => {
    const lookup = vi.fn(async () => testnetAccountFixtures.unfunded.result);

    await expect(
      diagnoseTestnetAccount('not-a-stellar-account', { lookup }),
    ).rejects.toThrow();

    expect(lookup).not.toHaveBeenCalled();
  });
  it('pins the default lookup to Testnet Horizon despite caller endpoint overrides', async () => {
    let requestedUrl: string | undefined;
    setHorizonServerFactory((url) => {
      requestedUrl = url;
      return {
        loadAccount: async () => ({
          balances: [
            {
              asset_type: 'native',
              balance: '25.0000000',
            },
          ],
        }),
      } as any;
    });

    const result = await diagnoseTestnetAccount(
      testnetAccountFixtures.funded.publicKey,
      {
        config: {
          network: 'mainnet',
          horizonUrl: 'https://horizon.stellar.org',
        },
      },
    );

    expect(requestedUrl).toBe('https://horizon-testnet.stellar.org');
    expect(result.status).toBe('funded');
    expect(result.network).toBe('testnet');
    expect(result.testnetOnly).toBe(true);
  });

});
