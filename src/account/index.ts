/**
 * Stellar PocketPay SDK — Account Module
 *
 * Provides the account abstraction layer that separates wallet identity,
 * signing capability, public account data, and transaction authorisation.
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  AccountIdentity,
  Signer,
  ExternalSignerAdapter,
  LocalSignerConfig,
  AccountAbstraction,
  ReadOnlyAccount,
  SigningAccount,
} from './types';

// ─── Capability check ─────────────────────────────────────────────────────────
export { canSignTransaction } from './types';

// ─── Signer implementations ──────────────────────────────────────────────────
export { LocalSigner, createLocalSigner } from './signer';

// ─── Account factories ───────────────────────────────────────────────────────
export {
  createReadOnlyAccount,
  createLocalAccount,
  createAccountWithSigner,
} from './account';

// ─── Sequence handling ───────────────────────────────────────────────────────
export {
  SequenceProvider,
  defaultSequenceProvider,
  validateSequenceValue,
  isSequenceStale,
  DEFAULT_SEQUENCE_MAX_AGE_MS,
} from './sequence';

export type { SequenceSnapshot, SequenceProviderOptions } from './sequence';

// ─── Testnet account diagnostics ─────────────────────────────────────────────
export { diagnoseTestnetAccount } from './testnet';
export type {
  TestnetAccountStatus,
  TestnetAccountDiagnostic,
  FundedTestnetAccountDiagnostic,
  UnfundedTestnetAccountDiagnostic,
  UnavailableTestnetAccountDiagnostic,
  TestnetAccountLookup,
  DiagnoseTestnetAccountOptions,
} from './testnet';
