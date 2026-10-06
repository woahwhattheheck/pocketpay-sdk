# Vault operation previews

`buildVaultOperationPreview` creates a typed review model for vault actions
without signing, simulating, or submitting a transaction. It is intended for
confirmation screens and support-safe UI state.

## Supported preview actions

| Preview action | Amount required | Executable by current SDK | Fee field |
| --- | --- | --- | --- |
| `deposit` | yes | yes | Stellar base-fee floor |
| `withdraw` | yes | yes | Stellar base-fee floor |
| `createLock` | yes | no | Stellar base-fee floor |
| `getBalance` | no | yes | `0` |

The current savings-vault contract accounts for balances internally. Deposit
and withdraw previews therefore carry a warning that the preview does not imply
native XLM custody. Soroban resource fees are finalized during simulation, so
transaction previews expose the Stellar base fee as a floor rather than claiming
an exact final fee.

`createLock` is deliberately previewable so applications can render a future
review flow, but the returned `supported` field is `false` and the warnings
state that the current SDK cannot execute the lock action. A lock preview must
also include `unlockAt` as a positive integer Unix timestamp in seconds; the
same value is returned in the preview so the amount and lock timing can be
reviewed together before any future execution path exists.

## Example

```ts
import { buildVaultOperationPreview } from 'stellar-pocketpay-sdk';

const preview = buildVaultOperationPreview(
  {
    operation: 'deposit',
    wallet: 'G...',
    amount: '25',
  },
  { network: 'testnet' },
);

console.log(preview.operation);    // deposit
console.log(preview.asset);        // { code: 'XLM' }
console.log(preview.estimatedFee); // stroops
console.log(preview.warnings);
```

## Safe sharing

Previews accept a **public wallet address only**. Do not pass a secret key.
The preview object contains no signing material, transaction XDR, or submitted
transaction hash. Invalid public keys and required amounts use the SDK's existing
typed `PocketPayError` validation path.

A preview is informational. It never calls `depositToVault`,
`withdrawFromVault`, `getVaultBalance`, a Soroban RPC endpoint, or any
transaction-submission helper.
