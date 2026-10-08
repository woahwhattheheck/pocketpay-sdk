import { getHorizonServer } from '../config';
import { TransactionPollConfig, TransactionPollResult, TransactionRecord, SDKConfig } from '../types';
import { classifySubmitError } from '../errors';

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMER_MS = 2147483647;

function scheduleDeadline(complete: () => void, deadline: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  let cancelled = false;
  const schedule = () => {
    timer = setTimeout(() => {
      if (cancelled) return;
      if (Date.now() < deadline) schedule();
      else complete();
    }, Math.min(MAX_TIMER_MS, Math.max(0, deadline - Date.now())));
  };
  schedule();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.max(1, Math.floor(value as number))
    : fallback;
}

function abortError(): Error {
  const error = new Error('Transaction polling cancelled');
  error.name = 'AbortError';
  return error;
}

function pollingTimeoutError(): Error {
  const error = new Error('Transaction polling timed out');
  error.name = 'PollingTimeoutError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function withPollingBounds<T>(
  request: () => Promise<T>,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<T> {
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      cancelTimer();
      signal?.removeEventListener('abort', onAbort);
    };
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => rejectOnce(abortError());
    const cancelTimer = scheduleDeadline(
      () => rejectOnce(pollingTimeoutError()),
      deadline,
    );

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (Date.now() >= deadline) {
      rejectOnce(pollingTimeoutError());
      return;
    }

    try {
      request().then(
        (value) => {
          if (Date.now() >= deadline) rejectOnce(pollingTimeoutError());
          else resolveOnce(value);
        },
        (error) => {
          if (Date.now() >= deadline) rejectOnce(pollingTimeoutError());
          else rejectOnce(error);
        },
      );
    } catch (error) {
      if (Date.now() >= deadline) rejectOnce(pollingTimeoutError());
      else rejectOnce(error);
    }
  });
}

function waitForNextAttempt(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    const cancelTimer = scheduleDeadline(() => {
      cleanup();
      resolve();
    }, Date.now() + ms);
    const onAbort = () => {
      cancelTimer();
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/**
 * Polls Horizon for the confirmation status of a transaction by its hash.
 *
 * This helper performs status lookups only. It never submits or resubmits the
 * transaction, so retrying a status request cannot duplicate a payment.
 *
 * @param hash - The transaction hash to poll for.
 * @param config - Polling interval, timeout, attempt bound, and cancellation.
 * @param sdkConfig - Optional SDK config overrides.
 * @returns A typed poll result with both completion status and ledger state.
 */
export async function pollTransaction(
  hash: string,
  config: TransactionPollConfig = {},
  sdkConfig?: Partial<SDKConfig>
): Promise<TransactionPollResult> {
  const server = getHorizonServer(sdkConfig);
  const interval = positiveInteger(config.interval, DEFAULT_INTERVAL_MS);
  const timeout = positiveInteger(config.timeout, DEFAULT_TIMEOUT_MS);
  const derivedMaxAttempts = Math.max(1, Math.ceil(timeout / interval));
  const maxAttempts = positiveInteger(config.maxAttempts, derivedMaxAttempts);
  const startTime = Date.now();
  const deadline = startTime + timeout;

  let attempts = 0;
  let lastState: TransactionPollResult['state'] = 'unknown';

  while (attempts < maxAttempts && Date.now() - startTime < timeout) {
    throwIfAborted(config.signal);
    const remainingMs = timeout - (Date.now() - startTime);
    if (remainingMs <= 0) break;

    try {
      const tx = await withPollingBounds(
        () => {
          attempts += 1;
          return server.transactions().transaction(hash).call();
        },
        config.signal,
        deadline,
      );

      // Never confirm (or definitively fail) a different transaction just
      // because a transport returned a successful-looking object. Runtime
      // Horizon adapters are untrusted even when the TS interface is correct.
      if (
        !tx ||
        typeof tx.hash !== 'string' ||
        tx.hash.toLowerCase() !== hash.toLowerCase() ||
        typeof tx.successful !== 'boolean'
      ) {
        lastState = 'unknown';
      } else {
        const record: TransactionRecord = {
          hash: tx.hash,
          // `tx.ledger` is Horizon's link-follow helper, not the ledger number;
          // the numeric sequence is exposed as `ledger_attr`.
          ledger: tx.ledger_attr,
          createdAt: tx.created_at,
          sourceAccount: tx.source_account,
          // Horizon types `fee_charged` as `string | number`; preserve stroops.
          fee: String(tx.fee_charged),
          operationCount: tx.operation_count,
          successful: tx.successful,
          memo: tx.memo || undefined,
          memoType: tx.memo_type,
        };

        return {
          status: tx.successful ? 'success' : 'failure',
          state: tx.successful ? 'confirmed' : 'failed',
          hash,
          attempts,
          transaction: record,
        };
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      if (error?.name === 'PollingTimeoutError') {
        break;
      }

      const isNotFound = error?.response?.status === 404 || error?.status === 404;
      if (isNotFound) {
        lastState = 'pending';
      } else {
        const classified = classifySubmitError(error, hash);
        const retryable =
          classified.code === 'TX_STATUS_UNKNOWN' || classified.retryable === true;
        if (!retryable) {
          return {
            status: 'unknown',
            state: 'unknown',
            hash,
            attempts,
            error: classified.message,
          };
        }
        lastState = 'unknown';
      }
    }

    const elapsed = Date.now() - startTime;
    if (attempts >= maxAttempts || elapsed >= timeout) {
      break;
    }

    await waitForNextAttempt(
      Math.min(interval, Math.max(0, timeout - elapsed)),
      config.signal,
    );
  }

  const attemptBoundReached = attempts >= maxAttempts && Date.now() - startTime < timeout;
  return {
    status: 'timeout',
    state: lastState,
    hash,
    attempts,
    error: attemptBoundReached
      ? `Transaction polling stopped after ${attempts} attempts while status was ${lastState}`
      : `Transaction polling timed out after ${timeout}ms while status was ${lastState}`,
  };
}
