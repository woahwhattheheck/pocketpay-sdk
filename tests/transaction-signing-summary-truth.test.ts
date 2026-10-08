/**
 * #178: signing approval information must describe the transaction's actual
 * envelope, without floating-point conversion or signing/submitting it.
 */
import { describe, expect, it } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';
import {
  getTransactionSigningSummary,
  prepareTransactionOffline,
  type UnsignedTransaction,
} from '../src/transactions/offline-preparation';

describe('transaction signing summary truth', () => {
  it('formats a large stroop fee exactly on a prepared transaction', () => {
    const from = StellarSDK.Keypair.random().publicKey();
    const to = StellarSDK.Keypair.random().publicKey();
    const prepared = prepareTransactionOffline({
      sourcePublicKey: from,
      operations: [{
        destination: to,
        amount: '1',
        asset: { code: 'XLM' },
      }],
    });

    const summary = getTransactionSigningSummary({
      ...prepared,
      baseFee: '9007199254740993', // past Number.MAX_SAFE_INTEGER
    });
    expect(summary.fee).toBe('9007199254740993');
    expect(summary.feeInXlm).toBe('900719925.4740993');
    expect(summary.canSign).toBe(false);
  });

  it('uses the actual unsigned envelope rather than untrusted wrapper fields', () => {
    const source = StellarSDK.Keypair.random();
    const destination = StellarSDK.Keypair.random().publicKey();
    const issuer = StellarSDK.Keypair.random().publicKey();
    const builder = new StellarSDK.TransactionBuilder(
      new StellarSDK.Account(source.publicKey(), '123'),
      {
        fee: '100',
        networkPassphrase: StellarSDK.Networks.TESTNET,
      },
    );
    builder.addOperation(StellarSDK.Operation.payment({
      destination,
      amount: '1',
      asset: new StellarSDK.Asset('XLM', issuer),
    }));
    builder.setTimeout(60);
    const transaction = builder.build();
    const mismatch: UnsignedTransaction = {
      transaction,
      sourcePublicKey: StellarSDK.Keypair.random().publicKey(),
      networkPassphrase: StellarSDK.Networks.PUBLIC,
      hash: 'not-the-envelope-hash',
    };

    const summary = getTransactionSigningSummary(mismatch);
    expect(summary.source).toBe(source.publicKey());
    expect(summary.network).toBe(StellarSDK.Networks.TESTNET);
    expect(summary.networkName).toBe('Stellar Testnet');
    expect(summary.transactionHash).toBe(transaction.hash().toString('hex'));
    expect(summary.operations).toHaveLength(1);
    expect(summary.operations[0].assetCode).toBe('XLM');
    expect(summary.operations[0].assetIssuer).toBe(issuer);
    expect(summary.operations[0].description).toContain(issuer.substring(0, 8));
    // Summary is read-only: this call cannot sign or submit the envelope.
    expect(transaction.signatures).toHaveLength(0);
  });
});
