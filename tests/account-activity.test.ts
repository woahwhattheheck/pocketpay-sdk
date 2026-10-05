import { describe, expect, it } from 'vitest';
import {
  TransactionDirection,
  TransactionStatus,
  filterAccountActivity,
  mapPaymentReceiptToActivity,
  mapPaymentSummaryToActivity,
  mapTransactionSummaryToActivity,
  mapVaultResultToActivity,
  normalizeAccountActivity,
} from '../src';
import type {
  PaymentReceipt,
  PaymentSummary,
  TransactionSummary,
  VaultMappedResult,
} from '../src';

const ACCOUNT = 'GACCOUNT';
const OTHER = 'GOTHER';

const sentPayment: PaymentSummary = {
  id: 'op-1',
  transactionHash: 'tx-1',
  type: 'payment',
  createdAt: '2026-10-05T12:00:00.000Z',
  from: ACCOUNT,
  to: OTHER,
  amount: '12.5',
  asset: 'USDC',
  assetIssuer: 'GISSUER',
  pagingToken: '100',
};

describe('account activity normalization', () => {
  it('maps sent and received Horizon payments relative to the displayed account', () => {
    const sent = mapPaymentSummaryToActivity(sentPayment, ACCOUNT);
    const received = mapPaymentSummaryToActivity(
      { ...sentPayment, id: 'op-2', from: OTHER, to: ACCOUNT },
      ACCOUNT,
    );

    expect(sent.direction).toBe(TransactionDirection.OUTGOING);
    expect(sent.counterparty).toBe(OTHER);
    expect(sent.status).toBe(TransactionStatus.COMPLETED);
    expect(received.direction).toBe(TransactionDirection.INCOMING);
    expect(received.counterparty).toBe(OTHER);
  });

  it('preserves failed and unknown transaction states', () => {
    const failed: TransactionSummary = {
      hash: 'failed-tx',
      createdAt: '2026-10-05T11:00:00.000Z',
      sourceAccount: ACCOUNT,
      successful: false,
    };
    const unknown: TransactionSummary = {
      hash: 'unknown-tx',
      createdAt: '2026-10-05T10:00:00.000Z',
    };

    expect(mapTransactionSummaryToActivity(failed, ACCOUNT).status)
      .toBe(TransactionStatus.FAILED);
    expect(mapTransactionSummaryToActivity(unknown, ACCOUNT).status)
      .toBe(TransactionStatus.UNKNOWN);
  });

  it('preserves pending/unknown receipt states instead of treating them as failures', () => {
    const pending: PaymentReceipt = {
      status: TransactionStatus.PENDING,
      source: 'submission',
      actionRequired: 'retry',
      createdAt: '2026-10-05T13:00:00.000Z',
      transactionHash: 'pending-tx',
      amount: '2',
      asset: 'XLM',
      destination: OTHER,
    };
    const unknown: PaymentReceipt = {
      ...pending,
      status: TransactionStatus.UNKNOWN,
      actionRequired: 'poll',
      transactionHash: 'unknown-tx',
    };

    expect(mapPaymentReceiptToActivity(pending, ACCOUNT).status)
      .toBe(TransactionStatus.PENDING);
    expect(mapPaymentReceiptToActivity(unknown, ACCOUNT).status)
      .toBe(TransactionStatus.UNKNOWN);
  });

  it('maps vault direction/status without inventing a timestamp', () => {
    const deposit: VaultMappedResult = {
      success: true,
      status: 'success',
      operation: 'deposit',
      hash: 'vault-deposit',
      amount: '3',
    };
    const balance: VaultMappedResult = {
      success: true,
      status: 'success',
      operation: 'get_balance',
      balance: '9',
    };

    const depositActivity = mapVaultResultToActivity({
      result: deposit,
      createdAt: '2026-10-05T14:00:00.000Z',
    });
    const balanceActivity = mapVaultResultToActivity({
      result: balance,
      createdAt: '2026-10-05T14:01:00.000Z',
    });

    expect(depositActivity.direction).toBe(TransactionDirection.OUTGOING);
    expect(depositActivity.status).toBe(TransactionStatus.COMPLETED);
    expect(balanceActivity.direction).toBe('neutral');
    expect(balanceActivity.amount).toBe('9');
  });

  it('combines deterministic fixtures into reverse chronological history', () => {
    const records = normalizeAccountActivity({
      account: ACCOUNT,
      payments: [sentPayment],
      transactions: [{
        hash: 'tx-old',
        createdAt: '2026-10-05T09:00:00.000Z',
        sourceAccount: OTHER,
        successful: true,
      }],
      receipts: [{
        status: TransactionStatus.PENDING,
        source: 'submission',
        actionRequired: 'retry',
        createdAt: '2026-10-05T15:00:00.000Z',
        transactionHash: 'tx-new',
        destination: OTHER,
      }],
    });

    expect(records.map((record) => record.transactionHash))
      .toEqual(['tx-new', 'tx-1', 'tx-old']);
  });

  it('filters normalized history by status/kind/direction/asset', () => {
    const records = normalizeAccountActivity({
      account: ACCOUNT,
      payments: [sentPayment],
      receipts: [{
        status: TransactionStatus.PENDING,
        source: 'submission',
        actionRequired: 'retry',
        createdAt: '2026-10-05T15:00:00.000Z',
        transactionHash: 'pending',
        amount: '1',
        asset: 'XLM',
        destination: OTHER,
      }],
    });

    expect(filterAccountActivity(records, {
      kind: 'payment',
      status: TransactionStatus.PENDING,
      direction: TransactionDirection.OUTGOING,
      asset: 'XLM',
    }).map((record) => record.transactionHash)).toEqual(['pending']);
  });
});
