# Transaction queue consumer example (#207)

This shows how an app may serialize **one source account in one process** using existing PocketPay exports. It does **not** provide a durable queue or a safe way to abort on-chain operations. Keep a separate queue and `SequenceProvider` per network.

```ts
import {
  SequenceProvider, sendXLM, isUnknownStatusError,
  requiresRebuild, PocketPayError,
  type SendXLMParams,
} from 'stellar-pocketpay-sdk';

const sequences = new SequenceProvider({ maxAgeMs: 0 });

async function processSourceFIFO(
  sourcePublicKey: string,
  jobs: readonly SendXLMParams[],
  onReceipt: (receipt: Awaited<ReturnType<typeof sendXLM>>) => Promise<void>,
  onHold: (error: PocketPayError) => Promise<void>,
  onRebuild: (error: PocketPayError) => Promise<void>,
): Promise<void> {
  for (const payment of jobs) {
    try {
      const receipt = await sequences.withSequence(sourcePublicKey, () =>
        sendXLM(payment, { network: 'testnet' }));
      await onReceipt(receipt);
    } catch (error) {
      if (!(error instanceof PocketPayError)) throw error;
      if (isUnknownStatusError(error)) {
        await onHold(error); // persist original hash and poll
        return; // do not process the next source-account item
      }
      if (requiresRebuild(error)) {
        await onRebuild(error); // new authorization, NOT blind replay
        return;
      }
      throw error; // app must handle other failures explicitly
    }
  }
}
```

**Critical:** `withSequence` releases its lock when a callback finishes. If a wrapper converts uncertain submissions to a nonthrowing result, the application must *also* inspect that result and keep the queue held. A timeout must never be treated as evidence of a failed payment. No automatic retry of a rebuilt intent.

## Acceptance examples for a real scheduler

1. A/B from one account execute FIFO; C from another may run independently.
2. Queued/pre-send cancel prevents broadcast; post-send cancel only records a request.
3. Unknown submission blocks B until A's **original hash** resolves.
4. Stale sequence fails closed and requires new signing approval.
5. Restart after send restores a held hash; no hash implies manual review, not replay.
6. Testnet and Public never share an account sequence cache.
7. Competing workers must be fenced; local `withSequence` is not distributed locking.

See [queue design](./transaction-queue-contract.md), [sequence safety](./sequence-safety.md) and [transaction lifecycle](./transaction-lifecycle.md).
