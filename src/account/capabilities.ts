/**
 * Per-account capabilities for view, sign, and signed-transaction submission.
 *
 * A configured broadcast transport is independent from the account signer:
 * watch-only clients may broadcast an already signed transaction, and a local
 * signer need not have any network submission privileges.
 */
import type * as StellarSDK from '@stellar/stellar-sdk';
import type { AccountAbstraction } from './types';

/** A caller-provided way to broadcast an ALREADY signed transaction. */
export interface AccountSubmissionTransport {
  submitSignedTransaction(
    transaction: StellarSDK.Transaction | StellarSDK.FeeBumpTransaction,
  ): Promise<unknown>;
}

/**
 * Snapshot of features that the caller has configured at this moment.
 * canSubmit means a submit function is present, NOT that network access,
 * authorization, transaction validity or inclusion has been verified.
 */
export interface AccountCapabilitySnapshot {
  readonly canView: true;
  readonly canSign: boolean;
  readonly canSubmit: boolean;
  readonly submission: 'configured' | 'missing';
}

/** Runtime guard, also safe when given malformed JavaScript inputs. */
export function hasSubmissionTransport(value: unknown): value is AccountSubmissionTransport {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return typeof (value as Partial<AccountSubmissionTransport>).submitSignedTransaction === 'function';
  } catch {
    // A malformed caller transport may expose a throwing getter. Do not
    // certify submission capability or interrupt the read-only snapshot.
    return false;
  }
}

/**
 * Reports account capabilities without signing, broadcasting or looking up
 * Horizon state. A mismatched signer is never certified signing-capable.
 * External adapters explicitly reporting isAvailable=false are not ready.
 */
export function getAccountCapabilities(
  account: AccountAbstraction,
  transport?: AccountSubmissionTransport,
): AccountCapabilitySnapshot {
  const signer = account.signer;
  const matchedSigner =
    account.canSign === true &&
    signer !== undefined &&
    typeof signer.sign === 'function' &&
    signer.publicKey === account.publicKey;
  let signerAvailable = false;
  if (signer !== undefined) {
    try {
      // A missing or undefined optional probe is not an explicit denial.
      signerAvailable =
        !('isAvailable' in signer) ||
        signer.isAvailable === undefined ||
        signer.isAvailable === true;
    } catch {
      // Unreadable hardware/remote availability must fail closed.
      signerAvailable = false;
    }
  }
  const configuredSubmit = hasSubmissionTransport(transport);

  return Object.freeze({
    canView: true as const,
    canSign: Boolean(matchedSigner && signerAvailable),
    canSubmit: configuredSubmit,
    submission: configuredSubmit ? 'configured' as const : 'missing' as const,
  });
}
