import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig, validatePocketPayConfig } from '../src';

describe('contract id environment precedence', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers the vault-specific environment value and falls back to Stellar', () => {
    const vaultId = `C${'A'.repeat(55)}`;
    const stellarId = `C${'B'.repeat(55)}`;

    process.env.VAULT_CONTRACT_ID = vaultId;
    process.env.STELLAR_CONTRACT_ID = stellarId;
    expect(resolveConfig()).toMatchObject({
      contractId: vaultId,
      sources: { contractId: 'env' },
    });
    expect(validatePocketPayConfig().config?.contractId).toBe(vaultId);

    delete process.env.VAULT_CONTRACT_ID;
    expect(resolveConfig().contractId).toBe(stellarId);
    expect(validatePocketPayConfig().config?.contractId).toBe(stellarId);
  });
});
