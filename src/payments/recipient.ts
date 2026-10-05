import { PocketPayError } from '../types';
import { validateDestinationLocal } from './destination-validation';

export type RecipientSource = 'direct' | 'saved_contact' | 'destination_metadata';

export interface SavedContactRecipient {
  kind: 'saved_contact';
  publicKey: string;
  contactId?: string;
  name?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentDestinationRecipient {
  kind: 'destination';
  address: string;
  label?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
}

export type RecipientInput = string | SavedContactRecipient | PaymentDestinationRecipient;

export interface NormalizedRecipient {
  publicKey: string;
  source: RecipientSource;
  contactId?: string;
  label?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
}

export type RecipientValidationStatus =
  | 'valid'
  | 'missing'
  | 'invalid_shape'
  | 'invalid_public_key';

export type RecipientValidationResult =
  | {
      valid: true;
      status: 'valid';
      recipient: NormalizedRecipient;
    }
  | {
      valid: false;
      status: Exclude<RecipientValidationStatus, 'valid'>;
      code: 'INVALID_PUBLIC_KEY' | 'INVALID_RECIPIENT';
      message: string;
    };

interface RecipientCandidate extends NormalizedRecipient {}

function trimmedOptional(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function candidateFromInput(input: unknown): RecipientCandidate | RecipientValidationResult {
  if (typeof input === 'string') {
    const publicKey = input.trim();
    if (!publicKey) {
      return {
        valid: false,
        status: 'missing',
        code: 'INVALID_PUBLIC_KEY',
        message: 'Recipient public key is required',
      };
    }
    return { publicKey, source: 'direct' };
  }

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      status: 'invalid_shape',
      code: 'INVALID_RECIPIENT',
      message: 'Recipient must be a Stellar public key or recipient descriptor',
    };
  }

  const descriptor = input as Record<string, unknown>;

  if (descriptor.kind === 'saved_contact') {
    const publicKey = trimmedOptional(descriptor.publicKey);
    if (!publicKey) {
      return {
        valid: false,
        status: 'missing',
        code: 'INVALID_PUBLIC_KEY',
        message: 'Saved contact recipient requires a public key',
      };
    }

    return {
      publicKey,
      source: 'saved_contact',
      contactId: trimmedOptional(descriptor.contactId),
      label: trimmedOptional(descriptor.name),
      memo: typeof descriptor.memo === 'string' ? descriptor.memo : undefined,
      metadata:
        descriptor.metadata && typeof descriptor.metadata === 'object' && !Array.isArray(descriptor.metadata)
          ? { ...(descriptor.metadata as Record<string, unknown>) }
          : undefined,
    };
  }

  if (descriptor.kind === 'destination') {
    const publicKey = trimmedOptional(descriptor.address);
    if (!publicKey) {
      return {
        valid: false,
        status: 'missing',
        code: 'INVALID_PUBLIC_KEY',
        message: 'Payment destination recipient requires an address',
      };
    }

    return {
      publicKey,
      source: 'destination_metadata',
      label: trimmedOptional(descriptor.label),
      memo: typeof descriptor.memo === 'string' ? descriptor.memo : undefined,
      metadata:
        descriptor.metadata && typeof descriptor.metadata === 'object' && !Array.isArray(descriptor.metadata)
          ? { ...(descriptor.metadata as Record<string, unknown>) }
          : undefined,
    };
  }

  return {
    valid: false,
    status: 'invalid_shape',
    code: 'INVALID_RECIPIENT',
    message: 'Recipient descriptor kind must be "saved_contact" or "destination"',
  };
}

/**
 * Validate and normalize a direct address, saved contact, or payment destination.
 *
 * Address checks delegate to the shared destination validator so recipient
 * handling follows the same Stellar StrKey/checksum rules as payment flows.
 */
export function validateRecipient(input: unknown): RecipientValidationResult {
  const candidate = candidateFromInput(input);
  if ('valid' in candidate) return candidate;

  const destination = validateDestinationLocal(candidate.publicKey);
  if (!destination.valid) {
    return {
      valid: false,
      status: 'invalid_public_key',
      code: 'INVALID_PUBLIC_KEY',
      message: 'Recipient must contain a valid Stellar public key (G...)',
    };
  }

  return {
    valid: true,
    status: 'valid',
    recipient: candidate,
  };
}

/**
 * Throwing normalization helper for call sites that require a canonical
 * recipient before continuing.
 */
export function normalizeRecipient(input: RecipientInput): NormalizedRecipient {
  const result = validateRecipient(input);
  if (result.valid) return result.recipient;

  throw new PocketPayError(result.message, result.code, {
    validation: {
      field: 'recipient',
      reason: result.status,
    },
  });
}
