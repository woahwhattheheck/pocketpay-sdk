# Transaction Polling

`pollTransaction` checks Horizon for a submitted transaction by hash. It only
performs read-only status lookups: it never submits or resubmits the transaction.

```ts
import { pollTransaction } from 'stellar-pocketpay-sdk';

const controller = new AbortController();

const result = await pollTransaction(txHash, {
  interval: 2_000,
  timeout: 30_000,
  maxAttempts: 15,
  signal: controller.signal,
});

if (result.state === 'confirmed') {
  console.log('Confirmed', result.transaction);
} else if (result.state === 'failed') {
  console.error('Failed on ledger', result.transaction);
} else if (result.state === 'pending') {
  console.warn('Still pending when polling stopped');
} else {
  console.warn('Status could not be determined', result.error);
}
```

## Result model

The result intentionally exposes two related fields:

- `state`: `confirmed | failed | pending | unknown` -- the last ledger state
  observed.
- `status`: `success | failure | timeout | unknown` -- the backwards-compatible
  completion status of the polling operation.
- `attempts`: number of Horizon status lookups performed.

A Horizon `404 Not Found` means the transaction is not visible in a ledger yet,
so it is treated as `pending` and polling continues. A confirmed Horizon record
maps to `confirmed` or `failed` from its `successful` field. Non-retryable
lookup failures map to `unknown`.

When polling stops because of `timeout` or `maxAttempts`, inspect `state` to
distinguish a transaction that was still pending from an indeterminate network
status.

## Bounds and cancellation

- `interval` defaults to 2 seconds.
- `timeout` defaults to 30 seconds.
- `maxAttempts` is optional. When omitted, a safe bound is derived from
  `timeout / interval`, preserving the existing time-based behaviour.
- `signal` accepts an `AbortSignal`. Aborting rejects with an `AbortError`
  and stops scheduling further status lookups.

Cancellation only affects polling. It does not cancel, retry, or resubmit the
original transaction.
