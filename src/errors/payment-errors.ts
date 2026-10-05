import { PocketPayError } from '../types';
import { ErrorCategory } from './codes';
import { redactSensitive } from './taxonomy';

/**
 * Legacy QR/parser error codes. These remain exported for compatibility with
 * the payment payload parser; payment execution uses PaymentError below.
 */
export enum PaymentErrorCode {
  InvalidAddress = 'INVALID_ADDRESS',
  InvalidAmount = 'INVALID_AMOUNT',
  InvalidAsset = 'INVALID_ASSET',
  InvalidMemo = 'INVALID_MEMO',
  InvalidMetadata = 'INVALID_METADATA',
}

export class PaymentParseError extends Error {
  code: PaymentErrorCode;

  constructor(message: string, code: PaymentErrorCode) {
    super(message);
    this.name = 'PaymentParseError';
    this.code = code;
  }
}

/**
 * Stable payment-specific failure categories. These sit below the SDK-wide
 * ErrorCategory taxonomy and let applications choose recovery behavior without
 * parsing provider messages or Horizon result text.
 */
export enum PaymentFailureCategory {
  Validation = 'VALIDATION',
  Network = 'NETWORK',
  Account = 'ACCOUNT',
  Asset = 'ASSET',
  Fee = 'FEE',
  Submission = 'SUBMISSION',
}

export interface PaymentErrorOptions {
  statusCode?: number;
  cause?: Error;
  validation?: PocketPayError['validation'];
  transactionHash?: string;
  retryable?: boolean;
  sdkCategory?: ErrorCategory | string;
  safeMessage?: string;
  timeout?: PocketPayError['timeout'];
}

/**
 * Typed payment failure returned by sendXLM/sendAsset and their safe wrappers.
 *
 * `code` remains the existing fine-grained SDK code for compatibility.
 * `paymentCategory` is the stable recovery category introduced for issue #442.
 */
export class PaymentError extends PocketPayError {
  public readonly paymentCategory: PaymentFailureCategory;

  constructor(
    message: string,
    code: string,
    paymentCategory: PaymentFailureCategory,
    options: PaymentErrorOptions = {},
  ) {
    const details: {
      statusCode?: number;
      cause?: Error;
      validation?: PocketPayError['validation'];
      category?: string;
      safeMessage?: string;
      timeout?: PocketPayError['timeout'];
    } = {
      category: options.sdkCategory ?? sdkCategoryFor(paymentCategory),
      safeMessage: options.safeMessage ?? safeMessageFor(paymentCategory),
    };

    if (options.statusCode !== undefined) details.statusCode = options.statusCode;
    if (options.cause !== undefined) details.cause = options.cause;
    if (options.validation !== undefined) details.validation = options.validation;
    if (options.timeout !== undefined) details.timeout = options.timeout;

    super(
      message,
      code,
      details,
      options.transactionHash,
      options.retryable ?? paymentCategory === PaymentFailureCategory.Network,
    );

    this.name = 'PaymentError';
    this.paymentCategory = paymentCategory;
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

const ACCOUNT_CODES = new Set([
  'ACCOUNT_NOT_FOUND',
  'UNFUNDED_DESTINATION',
  'WALLET_ACCOUNT_UNFUNDED',
]);

const ACCOUNT_TRANSACTION_CODES = new Set([
  'tx_insufficient_balance',
  'tx_no_source_account',
]);

const ACCOUNT_OPERATION_CODES = new Set([
  'op_underfunded',
  'op_no_destination',
]);

const ASSET_CODES = new Set([
  'INVALID_ASSET',
  'INVALID_ASSET_CODE',
  'MISSING_ASSET_ISSUER',
  'MISSING_TRUSTLINE',
  'TRUSTLINE_NOT_AUTHORIZED',
  'TRUSTLINE_LIMIT_EXCEEDED',
  'PAYMENT_TRUSTLINE_MISSING',
  'PAYMENT_ASSET_UNSUPPORTED',
  'TX_INVALID_ASSET',
  'TX_INVALID_ASSET_CODE',
]);

const VALIDATION_CODES = new Set([
  'INVALID_SECRET_KEY',
  'INVALID_PUBLIC_KEY',
  'INVALID_AMOUNT',
  'INVALID_AMOUNT_PRECISION',
  'INVALID_MEMO',
  'TX_INVALID_MEMO',
  'SELF_PAYMENT',
  'PAYMENT_SELF',
  'PAYMENT_INVALID_AMOUNT',
  'PAYMENT_INVALID_DESTINATION',
]);

const NETWORK_CODES = new Set([
  'REQUEST_TIMEOUT',
  'NET_RATE_LIMITED',
  'NET_TIMEOUT',
  'NET_UNREACHABLE',
  'NET_HTTP',
]);

const ASSET_OPERATION_CODES = new Set([
  'op_no_trust',
  'op_src_no_trust',
  'op_not_authorized',
  'op_src_not_authorized',
  'op_line_full',
  'op_no_issuer',
]);

function sdkCategoryFor(category: PaymentFailureCategory): ErrorCategory {
  switch (category) {
    case PaymentFailureCategory.Network:
      return ErrorCategory.Network;
    case PaymentFailureCategory.Submission:
      return ErrorCategory.Transaction;
    default:
      return ErrorCategory.Payment;
  }
}

function safeMessageFor(category: PaymentFailureCategory): string {
  switch (category) {
    case PaymentFailureCategory.Validation:
      return 'Check the payment inputs and try again.';
    case PaymentFailureCategory.Network:
      return 'The payment network is temporarily unavailable.';
    case PaymentFailureCategory.Account:
      return 'The payment account is unavailable or not funded.';
    case PaymentFailureCategory.Asset:
      return 'The payment asset or trustline cannot be used.';
    case PaymentFailureCategory.Fee:
      return 'The transaction fee is insufficient.';
    case PaymentFailureCategory.Submission:
      return 'The payment could not be submitted.';
  }
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unexpected payment failure';
}

function rawObject(error: unknown): any {
  if (error instanceof PocketPayError && error.cause) return error.cause as any;
  return error as any;
}

function resultCodes(error: unknown): { transaction?: string; operations?: string[] } | undefined {
  const raw = rawObject(error);
  const result = raw?.response?.data?.extras?.result_codes;
  if (!result || typeof result !== 'object') return undefined;

  return {
    transaction: typeof result.transaction === 'string' ? result.transaction : undefined,
    operations: Array.isArray(result.operations)
      ? result.operations.filter((value: unknown): value is string => typeof value === 'string')
      : undefined,
  };
}

function statusCode(error: unknown): number | undefined {
  if (error instanceof PocketPayError && error.statusCode !== undefined) {
    return error.statusCode;
  }
  const raw = rawObject(error);
  const status = raw?.response?.status ?? raw?.statusCode ?? raw?.status;
  return typeof status === 'number' ? status : undefined;
}

function networkLike(error: unknown): boolean {
  if (error instanceof PocketPayError && NETWORK_CODES.has(error.code)) return true;

  const raw = rawObject(error);
  const code = typeof raw?.code === 'string' ? raw.code.toUpperCase() : '';
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  const status = statusCode(error);
  if (status === 429 || (status !== undefined && status >= 500)) return true;

  const message = rawMessage(raw).toLowerCase();
  return /timeout|timed out|connection reset|network failure|network error|socket|unreachable/.test(message);
}

function sanitizeCause(cause: Error | undefined): Error | undefined {
  if (!cause) return undefined;
  const safe = new Error(redactSensitive(cause.message));
  safe.name = cause.name;
  return safe;
}

function sanitizeValidation(
  validation: PocketPayError['validation'],
): PocketPayError['validation'] {
  if (!validation) return undefined;
  return {
    ...validation,
    ...(typeof validation.value === 'string'
      ? { value: redactSensitive(validation.value) }
      : {}),
  };
}

function classifyCategory(error: unknown): PaymentFailureCategory {
  if (error instanceof PaymentError) return error.paymentCategory;

  const pocket = error instanceof PocketPayError ? error : undefined;
  const code = pocket?.code ?? '';
  const codes = resultCodes(error);
  const txCode = codes?.transaction?.toLowerCase();
  const operations = codes?.operations?.map((value) => value.toLowerCase()) ?? [];
  const message = pocket?.message.toLowerCase() ?? rawMessage(error).toLowerCase();

  if (txCode === 'tx_insufficient_fee' || message.includes('tx_insufficient_fee')) {
    return PaymentFailureCategory.Fee;
  }

  if (
    ACCOUNT_CODES.has(code) ||
    (txCode !== undefined && ACCOUNT_TRANSACTION_CODES.has(txCode)) ||
    operations.some((operation) => ACCOUNT_OPERATION_CODES.has(operation)) ||
    statusCode(error) === 404
  ) {
    return PaymentFailureCategory.Account;
  }

  if (
    ASSET_CODES.has(code) ||
    operations.some((operation) => ASSET_OPERATION_CODES.has(operation))
  ) {
    return PaymentFailureCategory.Asset;
  }

  if (pocket?.validation || VALIDATION_CODES.has(code)) {
    return PaymentFailureCategory.Validation;
  }

  if (code === 'TX_STATUS_UNKNOWN') {
    return PaymentFailureCategory.Submission;
  }

  if (networkLike(error)) {
    return PaymentFailureCategory.Network;
  }

  return PaymentFailureCategory.Submission;
}

/**
 * Normalize any payment-path failure into a PaymentError with a stable
 * paymentCategory, a redacted message/cause, and a user-safe message.
 */
export function classifyPaymentError(
  error: unknown,
  context = 'Payment failed',
): PaymentError {
  if (error instanceof PaymentError) return error;

  const paymentCategory = classifyCategory(error);
  const pocket = error instanceof PocketPayError ? error : undefined;
  const codes = resultCodes(error);
  const status = statusCode(error);

  let code = pocket?.code ?? 'SEND_ERROR';
  let message = pocket ? redactSensitive(pocket.message) : redactSensitive(rawMessage(error));
  let normalizedStatus = status;

  if (!pocket && status === 404) {
    code = 'ACCOUNT_NOT_FOUND';
    message = 'Source account not found.';
  } else if (!pocket && codes?.transaction) {
    code = 'PAYMENT_FAILED';
    normalizedStatus = status ?? 400;
    message = `Payment failed with transaction result code: ${redactSensitive(codes.transaction)}`;
  } else if (!pocket) {
    message = `${context}: ${message}`;
  }

  const originalCause =
    pocket?.cause ?? (error instanceof Error ? error : undefined);

  return new PaymentError(message, code, paymentCategory, {
    ...(normalizedStatus !== undefined ? { statusCode: normalizedStatus } : {}),
    ...(originalCause ? { cause: sanitizeCause(originalCause) } : {}),
    ...(pocket?.validation
      ? { validation: sanitizeValidation(pocket.validation) }
      : {}),
    ...(pocket?.transactionHash
      ? { transactionHash: pocket.transactionHash }
      : {}),
    ...(pocket?.timeout ? { timeout: pocket.timeout } : {}),
    retryable:
      pocket?.retryable ??
      paymentCategory === PaymentFailureCategory.Network,
    sdkCategory:
      pocket?.category ?? sdkCategoryFor(paymentCategory),
    safeMessage:
      pocket?.safeMessage !== undefined
        ? redactSensitive(pocket.safeMessage)
        : safeMessageFor(paymentCategory),
  });
}

export function isPaymentError(error: unknown): error is PaymentError {
  return error instanceof PaymentError;
}
