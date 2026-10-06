# SDK #463 deadline and bound validation

This packet records a local follow-up to the released polling source
`353bb4f4723f1a44f94d94ca2c798a8be493c912`, tree
`2e45e9920d314a0fe594f3033512b26a22cf1b81`.
The existing branch, nine polling tests, 429 retry handling, public exports,
types, dependencies and source history are preserved.

The candidate changes only `src/transactions/polling.ts`, `docs/polling.md`,
and the new `tests/polling-lifecycle.test.ts`. Its complete projected Git tree
is `850c620f5ba11057a822ead10cc24c637d300959`.

The released source can accept an already-late response before its timeout
callback runs, map an expired synchronous failure to an unknown result, and
expire valid long timers immediately because Node clamps overflowing timers.
Positive fractions can also become zero timing or attempt bounds. The
candidate checks the absolute deadline on completion and synchronous failure,
uses bounded timer chunks that retain the true deadline, and normalizes
positive finite bounds to at least one. Cancellation, pending/unknown state,
actual lookup counts, resource cleanup and read-only polling are retained.

## Observed results

- Same final owner selection: released source 16 passed / 7 failed;
  candidate 23 passed / 0 failed. The nine released polling cases are byte exact.
- Independent peer selection: released source 8 passed / 5 failed;
  candidate 13 passed / 0 failed.
- Strict scoped TypeScript: 0 errors.
- Full unit suites, excluding only `tests/friendbot.integration.test.ts`:
  sponsor base 1,117 passed / 2 failed; released source 1,121 passed / 2 failed;
  candidate 1,135 passed / 2 failed. The two QR parser failures are byte identical
  across all three executions. Their shared failure-block SHA-256 is
  `6c9890ff8df20e465755622b2cdbe060640a94df4b7330c3a8d205c377e90e2c`.
- Whole-source TypeScript retains the same eight QR parser type errors on
  sponsor base, released source and candidate. Their identical log SHA-256 is
  `49bb1a022b84f78e63aa76127c4f6fe2de9c4f12a7ad9d422590e9a04f57fc6c`.

Node 24.19.0, Vitest 3.2.7, TypeScript 5.9.3 and Stellar SDK 13.3.0 were used.
The previously installed base dependencies were reused read-only after
verifying unchanged package/lock bytes and all 186 installed package versions
against the lock. Forty-nine absent packages are optional platform packages;
no nonoptional package was absent. No dependency or installation change was made.

## Network boundary and reproduction

The validation harness denies unmocked Socket, TLS, HTTP, HTTPS, fetch and UDP
transports, and verifies the guard inside each worker before subject imports.
Owner focused and independent peer selections attempted no unmocked transport.
Each whole suite attempted four HTTPS calls and one fetch call, all denied
before transport. Those inherited attempts are retained; no live Horizon,
friendbot, signing, submission, RPC write, or integration result is claimed.

To reproduce after materializing the source and evidence packet, copy the
three harness files to the repository root. The validation configuration
imports the repository's unchanged Vitest configuration and adds the guard.

```sh
RUN_INTEGRATION=0 \
SDK333_GUARD_RECEIPT_DIR="$PWD/guard-results" \
NODE_OPTIONS="--require $PWD/validation-network-deny.cjs" \
node node_modules/vitest/vitest.mjs run \
  tests/polling.test.ts tests/polling-lifecycle.test.ts \
  --config validation-vitest.config.mts --maxWorkers=1 \
  --no-file-parallelism --reporter=verbose

RUN_INTEGRATION=0 \
SDK333_GUARD_RECEIPT_DIR="$PWD/guard-whole-results" \
NODE_OPTIONS="--require $PWD/validation-network-deny.cjs" \
node node_modules/vitest/vitest.mjs run \
  --config validation-vitest.config.mts \
  --exclude tests/friendbot.integration.test.ts \
  --maxWorkers=1 --no-file-parallelism --reporter=verbose
```

The receipt records the exact scoped TypeScript invocation, source/delta pins,
raw log hashes, per-worker guard records and peer proof. This is local evidence;
it does not establish a full build, coverage gate, live integration, hosted CI,
maintainer approval, assignment, reward or payment. A lookup already underway
may finish in Horizon's transport; its late result cannot change the completed
poll. The helper does not abort or resubmit the original transaction.
