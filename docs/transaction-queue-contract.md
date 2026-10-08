# Transaction queue design (#207)

Partition FIFO by network passphrase and source account; payment and vault writes from one account share ordering. Different sources can proceed independently.

States: queued -> preparing -> awaiting_signature -> submitting -> resolving -> confirmed/failed; queued/preparing/awaiting_signature may cancel **only before send**. Unknown or pending submission stays resolving (or manual_review after polling budget), holding subsequent work for that source. Cancellation after send is not reversal.

SequenceProvider.withSequence serializes one callback **within one process**, not a durable queue. A scheduler must hold the account across ambiguous outcomes, invalidate cached sequences after definitive results, and fence distributed submitters. TX_BAD_SEQUENCE needs fresh sequence and new signing; timeout/408/5xx after possible send needs original-hash reconciliation, never a new payment.

Persist job ID, partition, order, state and signed hash before broadcast; redact secrets/XDR. On restart reconcile held hashes before new submissions. App example: sequence.withSequence(source, () => sendXLM(payment)) in a FIFO loop, stop on isUnknownStatusError until finality. This is consumer guidance, not an exported queue implementation.

See docs/sequence-safety.md, docs/transaction-lifecycle.md and docs/idempotency.md.
