import { describe, expect, it } from 'vitest';
import { PocketPayError } from '../src/types';
import {
  normalizeRecipient,
  validateRecipient,
} from '../src/payments/recipient';
import { createPaymentIntentForRecipient } from '../src/payments/intent';
import {
  NATIVE_XLM_FIXTURE,
  VALID_DESTINATION_G,
  VALID_SOURCE_G,
} from './fixtures/multi-asset-fixtures';

describe('recipient validation and normalisation', () => {
  it('normalises a direct Stellar address', () => {
    const result = validateRecipient(`  ${VALID_DESTINATION_G}  `);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.recipient).toEqual({
        publicKey: VALID_DESTINATION_G,
        source: 'direct',
      });
    }
  });

  it('normalises saved-contact metadata without changing the public key', () => {
    const result = validateRecipient({
      kind: 'saved_contact',
      publicKey: ` ${VALID_DESTINATION_G} `,
      contactId: ' payroll-ops ',
      name: ' Payroll Ops ',
      memo: 'contact memo',
      metadata: { directory: 'mobile' },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.recipient).toEqual({
        publicKey: VALID_DESTINATION_G,
        source: 'saved_contact',
        contactId: 'payroll-ops',
        label: 'Payroll Ops',
        memo: 'contact memo',
        metadata: { directory: 'mobile' },
      });
    }
  });

  it('normalises payment destination metadata', () => {
    const recipient = normalizeRecipient({
      kind: 'destination',
      address: VALID_DESTINATION_G,
      label: 'Contractor',
      metadata: { invoiceId: 'inv-42' },
    });

    expect(recipient.publicKey).toBe(VALID_DESTINATION_G);
    expect(recipient.source).toBe('destination_metadata');
    expect(recipient.label).toBe('Contractor');
    expect(recipient.metadata).toEqual({ invoiceId: 'inv-42' });
  });

  it('returns typed failures for empty and malformed recipients', () => {
    expect(validateRecipient('')).toMatchObject({
      valid: false,
      status: 'missing',
      code: 'INVALID_PUBLIC_KEY',
    });

    expect(validateRecipient('not-a-stellar-address')).toMatchObject({
      valid: false,
      status: 'invalid_public_key',
      code: 'INVALID_PUBLIC_KEY',
    });

    expect(validateRecipient({ kind: 'unknown', address: VALID_DESTINATION_G })).toMatchObject({
      valid: false,
      status: 'invalid_shape',
      code: 'INVALID_RECIPIENT',
    });
  });

  it('throws a typed PocketPayError from normalizeRecipient on invalid input', () => {
    expect(() => normalizeRecipient('bad-address')).toThrow(PocketPayError);

    try {
      normalizeRecipient('bad-address');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_PUBLIC_KEY' });
    }
  });

  it('feeds a canonical saved recipient into payment intent creation', () => {
    const intent = createPaymentIntentForRecipient({
      source: VALID_SOURCE_G,
      recipient: {
        kind: 'saved_contact',
        publicKey: ` ${VALID_DESTINATION_G} `,
        contactId: 'contact-42',
        name: 'Payroll recipient',
        memo: 'saved memo',
        metadata: { team: 'ops' },
      },
      amount: '10.0000000',
      asset: NATIVE_XLM_FIXTURE,
      metadata: { checkoutId: 'chk-331' },
    });

    expect(intent.status).toBe('valid');
    expect(intent.destination).toBe(VALID_DESTINATION_G);
    expect(intent.memo).toBe('saved memo');
    expect(intent.metadata).toEqual({
      checkoutId: 'chk-331',
      recipient: {
        source: 'saved_contact',
        contactId: 'contact-42',
        label: 'Payroll recipient',
        metadata: { team: 'ops' },
      },
    });
  });

  it('prefers an explicit payment-intent memo over recipient metadata', () => {
    const intent = createPaymentIntentForRecipient({
      source: VALID_SOURCE_G,
      recipient: {
        kind: 'destination',
        address: VALID_DESTINATION_G,
        memo: 'recipient memo',
      },
      amount: '1.0000000',
      asset: NATIVE_XLM_FIXTURE,
      memo: 'explicit memo',
    });

    expect(intent.memo).toBe('explicit memo');
    expect(intent.validationResult?.valid).toBe(true);
  });
});
