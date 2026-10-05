SDK459 exact-source validation and cause-name repair

Source commit: `959b572f3cc0e23b303e8c8ffda26aeac180816d`  
Tested/published tree: `78a01979f742198990ba7a7a19903296b73d9bcd`  
Sole parent: `b7edca4fe5385653539def21916b20102db5e19e`  
Sponsor base: `ddd18b381d2dc7286eabf10046f2f9c768b3a6fb`  
Existing carrier: https://github.com/Stellar-PocketPay/pocketpay-sdk/pull/459

The one-line production change sanitizes cloned Error.name with the existing redaction helper. Two meaningful toResult tests show that a non-enumerable synthetic secret-shaped name fails on b7 and passes on the repaired tree, while ordinary TypeError name/message/stack/code and raw-error immutability are retained. Product scope is still the same two files; no dependencies or public API changed.

| Gate | Actual result |
| --- | --- |
| New six-case regression on exact b7 production source | 5 pass, 1 fail; exit 1 |
| Repaired focused regression | 6 pass; exit 0 |
| Repaired strict test/import types | Pass; exit 0 |
| Whole-source types | 8 preexisting QR-parser errors; exit 2; same on base and b7 |
| Original b7 ordinary unit suite | 1121 pass, 2 fail in 61 files; exit 1 |
| Repaired final ordinary unit suite with corrected transport guard | 1123 pass, 2 fail in 61 files; exit 1 |
| Base QR-parser cases | Same 2 failures; exit 1 |

The final unit command excludes the one opt-in friendbot integration file and sets RUN_INTEGRATION=0. The v2 validation-only Node transport guard blocks non-local hosts, including Node's normalized connect-argument arrays. Three outside-host argument shapes were smoke-checked before the underlying socket function. The two earlier v1 guarded full runs are retained as real test runs, but v1 had an argument-shape gap and does not support an outside-connection-blocked claim.

No integration, live signing, hosted CI, coverage, or all-green result is claimed. No usable signing seed or credential-valued field was found in publication artifacts. The invalid synthetic canary is redacted in two derived failing-before logs; other logs are verbatim. `publication-secret-scan.json` gives exact raw and derived hashes and exclusions. `receipt.json` retains all raw stdout/exit hashes, source pins, commands, limits, and peer review. `name-canary.log` is an earlier tsx CLI IPC bootstrap failure, superseded by the real regression proof.
