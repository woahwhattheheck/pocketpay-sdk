/**
 * Deterministic Testnet account diagnostics.
 *
 * This module is intentionally read-only: it never creates, funds, signs for,
 * or mutates an account. The default lookup always targets Stellar Testnet.
 */

import type { AccountBalance, BalanceResult, SDKConfig } from '../types';
import { HORIZON_URLS } from '../config';
import { validatePublicKey } from '../utils';
import { getBalanceOrUnfunded } from '../wallet';

export type TestnetAccountStatus = 'funded' | 'unfunded' | 'unavailable';

interface TestnetAccountDiagnosticBase {
  /** The public Stellar account being inspected. Never secret material. */
  publicKey: string;
  /** This helper never targets mainnet. */
  network: 'testnet';
  /** Explicit capability marker for consumers and diagnostics UIs. */
  testnetOnly: true;
}

export interface FundedTestnetAccountDiagnostic extends TestnetAccountDiagnosticBase {
  status: 'funded';
  balance: AccountBalance;
}

export interface UnfundedTestnetAccountDiagnostic extends TestnetAccountDiagnosticBase {
  status: 'unfunded';
}

export interface UnavailableTestnetAccountDiagnostic extends TestnetAccountDiagnosticBase {
  status: 'unavailable';
  /** Typed SDK/network code when the failing lookup exposes one. */
  errorCode?: string;
  /** Stable, non-sensitive message suitable for logs and UI. */
  message: string;
}

export type TestnetAccountDiagnostic =
  | FundedTestnetAccountDiagnostic
  | UnfundedTestnetAccountDiagnostic
  | UnavailableTestnetAccountDiagnostic;

/**
 * Injectable account-state lookup used by deterministic tests and offline
 * consumers. Implementations must not return secret material.
 */
export type TestnetAccountLookup = (publicKey: string) => Promise<BalanceResult>;

export interface DiagnoseTestnetAccountOptions {
  /**
   * Optional lookup override. Supplying one avoids all network I/O and is the
   * recommended path for unit tests and deterministic fixtures.
   */
  lookup?: TestnetAccountLookup;
  /**
   * Optional SDK settings for the default Horizon lookup. `network` is always
   * overridden to `testnet` by this helper.
   */
  config?: Partial<SDKConfig>;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Inspect a Stellar Testnet account and return a deterministic three-state
 * diagnostic: `funded`, `unfunded`, or `unavailable`.
 *
 * Invalid public keys remain programmer/input errors and are rejected before
 * any lookup is attempted. Horizon/network failures are converted to the
 * `unavailable` state without exposing raw provider errors or sensitive data.
 */
export async function diagnoseTestnetAccount(
  publicKey: string,
  options: DiagnoseTestnetAccountOptions = {},
): Promise<TestnetAccountDiagnostic> {
  validatePublicKey(publicKey);

  const base: TestnetAccountDiagnosticBase = {
    publicKey,
    network: 'testnet',
    testnetOnly: true,
  };

  try {
    const result = options.lookup
      ? await options.lookup(publicKey)
      : await getBalanceOrUnfunded(publicKey, {
          ...options.config,
          network: 'testnet',
          // Pin the actual account lookup boundary too. resolveConfig() otherwise
          // preserves a caller/env Horizon override even when network is testnet.
          horizonUrl: HORIZON_URLS.testnet,
        });

    if (result.status === 'funded') {
      return {
        ...base,
        status: 'funded',
        balance: result.balance,
      };
    }

    return {
      ...base,
      status: 'unfunded',
    };
  } catch (error) {
    const errorCode = readErrorCode(error);
    return {
      ...base,
      status: 'unavailable',
      ...(errorCode ? { errorCode } : {}),
      message: 'Testnet account state could not be determined.',
    };
  }
}
