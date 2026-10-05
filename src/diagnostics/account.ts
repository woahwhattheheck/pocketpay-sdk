/**
 * Account-focused diagnostics for support and payment-readiness triage.
 *
 * This report only consumes public account state and the SDK's already-redacted
 * configuration snapshot. It never accepts or returns signing material.
 */

import { getBalanceOrUnfunded } from '../wallet';
import type { SDKConfig } from '../types';
import { buildDiagnosticsReport } from './report';
import { redactDiagnosticsValue } from './redact';
import type {
  AccountDiagnosticsReport,
  AccountDiagnosticsSnapshot,
  BuildAccountDiagnosticsOptions,
  PaymentReadinessSnapshot,
} from './types';

function normalizeAccountError(error: unknown): { code: string; message: string } {
  let code = 'ACCOUNT_DIAGNOSTICS_ERROR';
  if (error && typeof error === 'object' && 'code' in error) {
    const candidate = (error as { code?: unknown }).code;
    if (typeof candidate === 'string') code = candidate;
  }

  // Do not forward provider messages into a shareable support report. They may
  // contain URLs, headers, account material, or other context the SDK cannot
  // classify safely.
  return {
    code,
    message: 'Account state could not be loaded.',
  };
}

function paymentReadiness(
  account: AccountDiagnosticsSnapshot,
  networkConfigured: boolean,
): PaymentReadinessSnapshot {
  if (account.status === 'error') {
    return {
      status: 'unknown',
      accountFunded: false,
      feeBalancePresent: false,
      networkConfigured,
      reasons: ['ACCOUNT_STATE_UNAVAILABLE'],
    };
  }

  const accountFunded = account.status === 'funded';
  const nativeBalance =
    account.nativeBalance === undefined ? 0 : Number(account.nativeBalance);
  const feeBalancePresent =
    accountFunded && Number.isFinite(nativeBalance) && nativeBalance > 0;

  const reasons: string[] = [];
  if (!accountFunded) reasons.push('ACCOUNT_UNFUNDED');
  if (accountFunded && !feeBalancePresent) reasons.push('NO_NATIVE_XLM_FOR_FEES');
  if (!networkConfigured) reasons.push('NETWORK_CONFIGURATION_UNAVAILABLE');

  return {
    status:
      accountFunded && feeBalancePresent && networkConfigured
        ? 'ready'
        : 'not_ready',
    accountFunded,
    feeBalancePresent,
    networkConfigured,
    reasons,
  };
}

/**
 * Build a support-safe diagnostics report for one public Stellar account.
 *
 * "ready" means the account-side prerequisites visible without constructing a
 * payment are present: the account is funded, it has a positive native XLM
 * balance for fees, and the configured network is recognized. Callers must
 * still perform normal per-payment validation for destination, amount,
 * trustlines, sequence and operation-specific requirements.
 *
 * Tests and offline consumers can inject `lookup` to avoid network I/O.
 */
export async function buildAccountDiagnosticsReport(
  publicKey: string,
  options: BuildAccountDiagnosticsOptions = {},
): Promise<AccountDiagnosticsReport> {
  const overrides: Partial<SDKConfig> | undefined = options.config;
  const base = buildDiagnosticsReport(overrides);

  let account: AccountDiagnosticsSnapshot;
  try {
    const result = options.lookup
      ? await options.lookup(publicKey, overrides)
      : await getBalanceOrUnfunded(publicKey, overrides);

    account =
      result.status === 'unfunded'
        ? {
            publicKey,
            status: 'unfunded',
          }
        : {
            publicKey,
            status: 'funded',
            nativeBalance: result.balance.nativeBalance,
            assetCount: result.balance.balances.length,
          };
  } catch (error) {
    const normalized = normalizeAccountError(error);
    account = {
      publicKey,
      status: 'error',
      errorCode: normalized.code,
      errorMessage: normalized.message,
    };
  }

  const networkConfigured =
    base.network.passphraseKnown && base.network.horizonUrl.length > 0;

  return redactDiagnosticsValue({
    ...base,
    account,
    paymentReadiness: paymentReadiness(account, networkConfigured),
  });
}
