# PocketPay SDK public API governance

This document defines the package-level compatibility boundary for [issue #317](https://github.com/Stellar-PocketPay/pocketpay-sdk/issues/317).

## Supported and internal imports

Consumers should use the package root. The **supported** TypeScript entrypoint is `stellar-pocketpay-sdk`, which is sourced from `src/index.ts` and published via `dist/index.js` and `dist/index.d.ts`. The published `package.json` export map allows only `.` and `./package.json`; the latter is package metadata, not a runtime SDK API.

```ts
// Supported: public package root (including type-only exports).
import { createWallet, type WalletKeypair } from 'stellar-pocketpay-sdk';

// Unsupported: private implementation modules may change without a public deprecation.
 // import { createWallet } from 'stellar-pocketpay-sdk/dist/wallet';
 // import type { WalletKeypair } from 'stellar-pocketpay-sdk/src/types';
```

Do **not** add consumer examples that import `src/`, `dist/`, or other private deep paths. Export new supported values and types explicitly from `src/index.ts`.

## Review and change policy

1. **Check first:** `npm run check:public-api`. This compares all named root exports (including type/value distinctions) and the `package.json` `main`, `types`, and `exports` contract to the committed `docs/public-api-surface.snapshot.json` baseline. CI runs the same focused check.
2. **Review differences:** Removed or renamed exports, changes from runtime values to type-only exports, and removed/redirected package subpaths are potentially **breaking**. Unless expressly approved as a breaking major release, retain the old entrypoint and add a compatibility alias or deprecation period instead.
3. **Check declarations and behavior:** The snapshot checks names and availability, **not** function parameter types, generic constraints, return types, declared class shape, runtime semantics, or transitive types. Compare generated `.d.ts` declarations / changed source signatures before approval. An incompatible required parameter, narrower accepted input, removed enum value, changed error behavior, or altered return contract can be breaking even when this check passes. Runtime/behavior changes require their own narrowly relevant regression coverage.
4. **Classify release impact:** Additive exports ordinarily qualify for a minor version; backward-compatible fixes normally for patch; incompatible exports, signatures, semantics or paths require deliberate major-version planning and migration notes. A pre-1.0 or testnet-only version does not excuse unexplained breaking changes. Update changelog/release notes and affected public examples alongside the change.
5. **Update baseline only after review:** Run `npm run update:public-api`, inspect the resulting snapshot diff, and commit it **with** the intentional public-surface change. Never blindly refresh the baseline to silence CI or to ratify an accidental removal. Reviewers should explicitly approve breaking changes and document consumer migration.
6. **Validate the governance script itself:** `npm run check:public-api:smoke` runs a small in-memory fixture covering type/value aliases, deterministic package key ordering, and rejection of wildcard/namespace exports. It does not launch the repository-wide test suite.

## Why use explicit exports?

`src/index.ts` currently contains an explicit named-export surface. `export *` or `export * as Name` would bypass human review of new exported symbols, so the governance command fails closed on those constructs until explicitly handled. It also reports duplicate kind/name entries rather than accepting an ambiguous snapshot.

The existing `docs/PUBLIC_API_COMPATIBILITY_CHECKLIST.md` was left unchanged; this new document is the canonical machine-readable snapshot procedure and compatibility policy, without silently replacing that older document.
