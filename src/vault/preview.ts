import * as StellarSDK from '@stellar/stellar-sdk';
import { resolveConfig } from '../config';
import { PocketPayError } from '../types';
import type { SDKConfig, StellarAssetSpec, StellarNetwork } from '../types';
import { validateAmount, validatePublicKey } from '../utils';
import {
  VAULT_ACTION_READINESS,
  type VaultActionKind,
} from './intents';

/** Vault actions that can be represented safely before execution. */
export type VaultPreviewAction = Extract<
  VaultActionKind,
  'deposit' | 'withdraw' | 'getBalance' | 'createLock'
>;

/** Input for a side-effect-free vault operation preview. */
export interface VaultOperationPreviewParams {
  /** Operation the UI is asking the user to review. */
  operation: VaultPreviewAction;
  /** Public wallet address only. Secret keys are never accepted by previews. */
  wallet: string;
  /** Required for deposit, withdraw, and createLock. Omit for getBalance. */
  amount?: string;
}

/** Stable review-before-action model for vault operations. */
export interface VaultOperationPreview {
  operation: VaultPreviewAction;
  /** Canonical native vault asset. */
  asset: StellarAssetSpec;
  /** Public wallet address; never a secret. */
  wallet: string;
  /** Requested amount, absent for a balance lookup. */
  amount?: string;
  network: StellarNetwork;
  /** Base fee estimate in stroops. Read-only balance previews use "0". */
  estimatedFee: string;
  /** Whether the current SDK can execute the modelled action today. */
  supported: boolean;
  /** Safe, non-secret caveats a confirmation UI can render verbatim. */
  warnings: string[];
}

const XLM_ASSET: StellarAssetSpec = Object.freeze({ code: 'XLM' });

const BOOKKEEPING_WARNING =
  'The current Savings Vault contract records internal balances; this preview does not imply native XLM custody.';
const SOROBAN_FEE_WARNING =
  'Estimated fee is the Stellar base-fee floor; final Soroban resource fees are determined during simulation.';
const LOCK_PREVIEW_WARNING =
  'Lock actions can be previewed, but the current SDK does not execute vault lock operations.';

function isVaultPreviewAction(operation: unknown): operation is VaultPreviewAction {
  return (
    operation === 'deposit' ||
    operation === 'withdraw' ||
    operation === 'getBalance' ||
    operation === 'createLock'
  );
}

function operationRequiresAmount(operation: VaultPreviewAction): boolean {
  return operation === 'deposit' || operation === 'withdraw' || operation === 'createLock';
}

function isSecretSeedLike(value: unknown): boolean {
  return typeof value === 'string' && /^S[A-Z2-7]{55}$/.test(value.trim());
}

/**
 * Builds a vault confirmation model without signing, simulating, or submitting.
 *
 * The preview accepts a public wallet address only so it is safe to log or
 * display as application state. Input validation delegates to the SDK's
 * existing typed validators.
 */
export function buildVaultOperationPreview(
  params: VaultOperationPreviewParams,
  config?: Partial<SDKConfig>,
): VaultOperationPreview {
  const runtimeOperation = (params as { operation?: unknown }).operation;
  if (!isVaultPreviewAction(runtimeOperation)) {
    const validationValue =
      typeof runtimeOperation === 'string' || typeof runtimeOperation === 'number'
        ? runtimeOperation
        : undefined;
    throw new PocketPayError('Invalid vault preview operation', 'INVALID_OPERATION', {
      validation: {
        field: 'operation',
        reason: 'unsupported_value',
        ...(validationValue !== undefined ? { value: validationValue } : {}),
      },
    });
  }

  if (isSecretSeedLike(params.wallet)) {
    throw new PocketPayError(
      'Vault previews require a public Stellar address; secret keys are not accepted',
      'INVALID_PUBLIC_KEY',
      {
        validation: {
          field: 'publicKey',
          reason: 'secret_key_not_allowed',
        },
      },
    );
  }
  validatePublicKey(params.wallet);

  if (operationRequiresAmount(params.operation)) {
    // Passing an empty value through the shared validator deliberately keeps
    // the SDK's existing PocketPayError validation contract.
    validateAmount(params.amount ?? '');
  }

  const resolved = resolveConfig(config);
  const readiness = VAULT_ACTION_READINESS[params.operation];
  const warnings: string[] = [];

  if (params.operation === 'deposit' || params.operation === 'withdraw') {
    warnings.push(BOOKKEEPING_WARNING);
  }

  if (params.operation === 'createLock') {
    warnings.push(LOCK_PREVIEW_WARNING);
  }

  if (params.operation !== 'getBalance') {
    warnings.push(SOROBAN_FEE_WARNING);
  }

  const preview: VaultOperationPreview = {
    operation: params.operation,
    asset: XLM_ASSET,
    wallet: params.wallet,
    network: resolved.network,
    estimatedFee:
      params.operation === 'getBalance' ? '0' : String(StellarSDK.BASE_FEE),
    supported: readiness.supported,
    warnings,
  };

  if (operationRequiresAmount(params.operation)) {
    preview.amount = params.amount;
  }

  return preview;
}
