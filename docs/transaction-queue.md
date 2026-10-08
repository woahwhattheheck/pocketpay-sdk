# Transaction queue abstraction

This document defines a queue contract for applications that need to serialize
PocketPay SDK payment or vault transaction intents. It is a design contract,
not a new exported runtime API yet: consumers can implement these rules locally
today, and a future SDK queue can adopt the proposed interface without changing
the transaction lifecycle guarantees.

The queue builds on [Account Sequence & Concurrency Safety](./sequence-safety.md)
and [Transaction Lifecycle](./transaction-lifecycle.md). Those documents remain
authoritative for Stellar sequence handling and submission reconciliation.

## Goals

A transaction queue should make five things explicit:

1. FIFO ordering for intents that spend the same source account sequence.
2. Independent progress for different source accounts.
3. Cancellation rules that never pretend an already-submitted transaction can
   be recalled.
4. Failure handling that distinguishes retry, rebuild, and status resolution.
5. Clear ownership boundaries between an in-process SDK helper and a durable,
   distributed application queue.

It must not turn an unsafe resubmission into a retry, hide an unresolved
submission, or claim cross-process coordination it cannot provide.

## Proposed states

Each queued item has one mutually exclusive state.

| State | Meaning | May cancel? | What can happen next |
| --- | --- | --- | --- |
| `queued` | Waiting for exclusive access to its source account. | yes | `preparing`, `cancelled` |
| `preparing` | Reading fresh network state and building the transaction. | yes, before signing starts | `signing`, `failed`, `cancelled` |
| `signing` | Waiting for an authorized signer capability. | best effort | `submitting`, `failed` |
| `submitting` | Signed envelope is being sent. | no | `reconciling`, `confirmed`, `failed` |
| `reconciling` | Submission outcome is unknown; hash is being resolved. | no | `confirmed`, `failed` |
| `confirmed` | Transaction is known to be on-chain. | no | terminal |
| `failed` | Definitive failure with an explicit recovery action. | no | terminal |
| `cancelled` | Work was removed before irreversible submission. | no | terminal |

`reconciling` is intentionally not called failure. Once an envelope may have
reached Horizon, the queue must preserve that envelope identity and resolve its
hash before allowing a replacement transaction for the same intent.

## Proposed queue item

A future runtime API can use a shape like this:

```ts
type TransactionQueueState =
  | 'queued'
  | 'preparing'
  | 'signing'
  | 'submitting'
  | 'reconciling'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

type TransactionQueueItem<TIntent> = {
  id: string;
  sourceAccount: string;
  intent: TIntent;
  state: TransactionQueueState;
  enqueuedAt: number;
  transactionHash?: string;
  failure?: {
    code: string;
    safeMessage: string;
    action: 'retry' | 'rebuild' | 'poll' | 'none';
  };
};
```

The intent stores business inputs, not signer credentials, signed transaction
payloads, or raw provider errors. Signer capability belongs at execution time
and must follow [Signing Boundaries](./signing-boundaries.md).

## Ordering and sequence ownership

### FIFO per source account

Items sharing a source account execute in enqueue order. Only one item for that
account may prepare, sign, submit, or reconcile at a time.

That rule matters because Stellar transactions consume a monotonically
increasing account sequence. Two concurrently prepared transactions can bind to
the same sequence and race; the loser is permanently invalid.

Before an item starts preparation, the worker should obtain exclusive access
with `SequenceProvider.withSequence(sourceAccount, task)` or an equivalent
single-writer boundary. After every submission attempt, successful or not,
sequence state must be invalidated so the next item reads Horizon again.

### Different accounts may progress independently

A queue should key serialization by source account, not globally. Payment A
from account A does not need to block payment B from account B.

### One process is not a distributed lock

An in-memory queue and `SequenceProvider.withSequence` coordinate one process
only. Applications with multiple workers, containers, browser tabs that can
submit independently, or server replicas must provide durable queue ownership
or a distributed lock outside the SDK.

A distributed worker should persist at least the queue item id, source account,
business intent identifier, current state, and any submitted transaction hash.
Execution credentials should remain outside durable queue records.

## Cancellation semantics

Cancellation is state-dependent.

### Queued

A queued item can be cancelled immediately. Remove it from the runnable FIFO,
mark it `cancelled`, and do not consume a sequence.

### Preparing

Cancellation may stop before a signed envelope exists. If preparation already
reserved local state, release or invalidate it before the next item runs.

### Signing

Cancellation is best effort. A consumer-controlled signer may already be
presenting an approval request. The queue can stop before submission, but it
must not treat a late signer response as authorization to submit after the item
was cancelled.

### Submitting or reconciling

Cancellation is rejected. A submitted Stellar transaction cannot be recalled.
The queue must continue reconciliation until it knows whether the transaction
confirmed or definitively failed.

This distinction should be visible to callers: `cancel(id)` should return a
typed result such as `{ cancelled: false, reason: 'already_submitted' }` rather
than silently reporting success.

## Failure policy

Queue behavior follows the transaction lifecycle recovery action.

| Outcome | Queue action |
| --- | --- |
| Validation or authorization failure before submission | Mark `failed`; next item may proceed after cleanup. |
| Retry-safe submission failure for the same envelope | Retry only under the SDK retry policy; do not rebuild. |
| `TX_BAD_SEQUENCE` / rebuild required | Mark the attempt failed, invalidate sequence state, rebuild from fresh network state only if application policy explicitly retries the business intent. |
| Submission status unknown | Enter `reconciling`; block later items for that source account until status is resolved. |
| Definitive on-chain rejection | Mark `failed`, invalidate sequence state, then allow the next item to prepare fresh. |
| Confirmed | Mark `confirmed`, invalidate or refresh sequence state, then release the next item. |

### Why unresolved blocks the account lane

If the queue lets a later item consume the next sequence while an earlier
submission is unresolved, it can no longer reason safely about which sequence
the network accepted. The account lane therefore remains locked while an item
is `reconciling`.

Applications that need a time bound may surface the item as pending to the user,
but they must not convert timeout into failure and enqueue a replacement
payment automatically.

## Consumer responsibilities

Applications adopting this design are responsible for:

- choosing a stable business intent id so UI retries do not create duplicate
  queue items;
- supplying an authorized signer capability at execution time;
- persisting queue state if process restarts must be recoverable;
- using a distributed ownership mechanism when more than one process can submit
  from the same Stellar account;
- surfacing `reconciling` as pending or unknown, never as a failed payment;
- deciding whether a definitive failure should create a new business attempt;
- observing queue depth, oldest-item age, and repeated failures with
  support-safe telemetry.

## Integration example: ordered payments

The following is illustrative application code. `TransactionQueue` is the
proposed abstraction, not a current package export.

```ts
const queue = new TransactionQueue({
  keyBy: (intent) => intent.sourcePublicKey,
});

const receipt = await queue.enqueue({
  id: checkoutId,
  sourcePublicKey,
  run: ({ sequenceProvider, signer }) =>
    sequenceProvider.withSequence(sourcePublicKey, () =>
      submitPaymentIntent(paymentIntent, { signer })
    ),
});

if (receipt.state === 'reconciling') {
  showPendingPayment(receipt.transactionHash);
}
```

The application should deduplicate `checkoutId` before enqueueing. A user
double-click must not become two business intents.

## Integration example: vault operations

Vault deposits and withdrawals from the same source account belong to the same
account lane as ordinary payments when they consume that account's sequence.

```ts
await queue.enqueue({
  id: `vault-deposit:${depositId}`,
  sourcePublicKey,
  run: ({ signer }) => submitVaultIntent(depositIntent, { signer }),
});

await queue.enqueue({
  id: `payment:${invoiceId}`,
  sourcePublicKey,
  run: ({ signer }) => submitPaymentIntent(paymentIntent, { signer }),
});
```

FIFO ordering guarantees the payment does not race the preceding vault
operation for the same sequence. A vault operation for a different source
account can run concurrently.

## Suggested runtime interface

A future implementation can expose a small capability-oriented surface:

```ts
interface TransactionQueue<TIntent, TResult> {
  enqueue(intent: TIntent): Promise<TResult>;
  cancel(id: string): Promise<
    | { cancelled: true }
    | { cancelled: false; reason: 'not_found' | 'already_submitted' }
  >;
  get(id: string): TransactionQueueItem<TIntent> | undefined;
  list(sourceAccount?: string): readonly TransactionQueueItem<TIntent>[];
}
```

The runtime implementation should delegate preparation, guarded submission,
reconciliation, and sequence safety to existing SDK primitives rather than
reimplementing those rules inside the queue.

## Implementation path

1. Keep this document as the behavioral contract.
2. Introduce a queue item/state type with no persistence assumptions.
3. Add an in-memory per-account FIFO that composes `SequenceProvider`.
4. Route execution through the existing transaction lifecycle and guarded
   submission primitives.
5. Add cancellation tests at each state boundary.
6. Add restart or distributed coordination only as an application adapter, not
   as a hidden promise of the core SDK.

## Related guidance

- [Transaction Lifecycle](./transaction-lifecycle.md)
- [Account Sequence & Concurrency Safety](./sequence-safety.md)
- [Retry Policy](./retry-policy.md)
- [Idempotency](./idempotency.md)
- [Signing Boundaries](./signing-boundaries.md)
- [Offline Transaction Preparation](./offline-transaction-preparation.md)
