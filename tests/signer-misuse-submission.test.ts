/**
 * Issue #213: signature capability boundary at the real Horizon submission edge.
 * Existing signer-capability tests cover missing, read-only and wrong signers.
 * These cases prove an unsigned envelope cannot reach the network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';
import { ErrorCode } from '../src/errors';
import { submitWithGuard } from '../src/transactions/guarded-submit';

const { mockSubmitTransaction, mockGetHorizonServer } = vi.hoisted(() => ({
  mockSubmitTransaction: vi.fn(),
  mockGetHorizonServer: vi.fn(),
}));

vi.mock('../src/config', async (importActual) => ({
  ...(await importActual<typeof import('../src/config')>()),
  getHorizonServer: mockGetHorizonServer,
}));

function payment(): { transaction: StellarSDK.Transaction; source: StellarSDK.Keypair } {
  const source = StellarSDK.Keypair.random();
  const transaction = new StellarSDK.TransactionBuilder(
    new StellarSDK.Account(source.publicKey(), '100'),
    { fee: StellarSDK.BASE_FEE, networkPassphrase: StellarSDK.Networks.TESTNET },
  )
    .addOperation(StellarSDK.Operation.payment({
      destination: StellarSDK.Keypair.random().publicKey(),
      asset: StellarSDK.Asset.native(),
      amount: '1',
    }))
    .setTimeout(30)
    .build();
  return { transaction, source };
}

describe('signer misuse: guarded Horizon submission', () => {
  beforeEach(() => {
    mockSubmitTransaction.mockReset();
    mockGetHorizonServer.mockReset();
    mockGetHorizonServer.mockReturnValue({ submitTransaction: mockSubmitTransaction });
  });

  it('rejects unsigned input with a typed safe error before creating a Horizon server', async () => {
    const { transaction } = payment();
    expect(transaction.signatures).toHaveLength(0);

    await expect(submitWithGuard(transaction)).rejects.toMatchObject({
      code: ErrorCode.TX_SIGNER_MISSING,
      validation: { field: 'signatures', reason: 'missing' },
    });
    expect(mockGetHorizonServer).not.toHaveBeenCalled();
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  it('keeps the signed envelope path enabled and submits only once', async () => {
    const { transaction, source } = payment();
    transaction.sign(source);
    const response = { hash: 'signed-envelope-accepted', ledger: 12 };
    mockSubmitTransaction.mockResolvedValueOnce(response);

    await expect(submitWithGuard(transaction)).resolves.toEqual(response);
    expect(mockGetHorizonServer).toHaveBeenCalledTimes(1);
    expect(mockSubmitTransaction).toHaveBeenCalledOnce();
    expect(mockSubmitTransaction).toHaveBeenCalledWith(transaction);
  });
});
