# Contributor Evaluation Policy

This policy explains how PocketPay SDK contributions are evaluated after implementation and review. It applies to repository contributions, including work associated with GrantFox campaigns.

## Merge does not guarantee payment approval

A merged pull request means the repository accepted the technical change. It does **not** automatically mean that a contribution is approved for a GrantFox reward or other payment.

GrantFox evaluation is a separate step. Evaluation may consider whether the contribution:

- completes the issue rather than only part of it,
- satisfies every applicable acceptance criterion,
- includes appropriate test evidence for behaviour changes,
- has an acceptable CI state,
- includes required documentation,
- addresses maintainer review feedback, and
- follows repository contribution and security standards.

Labels such as `Maybe Rewarded` or campaign participation describe evaluation eligibility; they are not a promise of payment.

## Before requesting evaluation

Contributors should make the review evidence easy to inspect.

1. Map every issue acceptance criterion to concrete evidence using [Acceptance Criteria Traceability](./acceptance-criteria-traceability.md).
2. For behaviour changes, follow the [Testing](./testing.md) guidance and the [SDK Module Test Matrix](./module-test-matrix.md).
3. Run `npm run presubmit` and preferably `npm run verify:pr` as described in [Pre-PR Verification](./pre-pr-verification.md).
4. Complete the [Contributor Self-Review Form](../.github/checklists/contributor-self-review.template.md).
5. Confirm the PR description records the tests or verification actually run, current CI status, documentation changes, and known limitations.

Do not claim checks that were not executed. If a failure is pre-existing or a hosted check cannot run, document that boundary plainly.

## Maintainer review standard

Maintainers use the [Contribution Quality Gate](./contribution-quality-gate.md) to decide whether issue work is complete enough for approval. Review is based on the requested outcome, not patch size.

For code changes, reviewers normally expect:

- implementation in the correct owning module,
- focused tests for new behaviour and meaningful failure paths,
- no unrelated refactor or dependency churn,
- documentation for public behaviour changes, and
- a complete acceptance-criteria mapping.

For documentation-only issues, contributors should not add artificial code or tests merely to increase the size of the change. Review should instead verify that the requested documentation exists, is discoverable, uses valid repository links, and satisfies the issue criteria.

## GrantFox evaluation

When a contribution is associated with GrantFox, repository review and GrantFox evaluation are related but distinct.

A contribution should reach evaluation with a clear evidence trail: issue, PR, acceptance-criteria mapping, verification performed, CI state, and maintainer review outcome. A merge by itself is not a reward decision.

Contributors should use the current campaign or provider process for evaluation and payment-status questions. Do not infer approval from a merge, label, application, or issue comment.

## Payment-period conduct

During evaluation or payment periods:

- do not repeat the same payment-status request across issues, pull requests, community channels, and direct messages;
- do not repeatedly ping maintainers because a contribution has merged;
- keep a status question concise and include the relevant issue or PR link;
- allow the evaluation process to complete before escalating an unchanged status; and
- keep technical review discussion separate from payment pressure.

PocketPay's shared campaign guidance is documented in the
[Payment-Period Conduct Guidance](https://github.com/Axionvera/pocketpay-contracts/blob/main/docs/payment-period-conduct.md).

## Acceptance criteria remain authoritative

A PR is not complete merely because it compiles, passes tests, or is mergeable. The issue's acceptance criteria define the requested outcome.

If a criterion is intentionally not completed, mark it clearly in the PR's traceability table and explain why. Unexplained partial work should not be presented as evaluation-ready.

Use the [Acceptance Criteria Traceability](./acceptance-criteria-traceability.md) format and the repository's [PR template](../.github/PULL_REQUEST_TEMPLATE.md) so reviewers can verify the mapping without reconstructing it from the diff.

## Related guidance

- [Evaluation Readiness Index](./evaluation-readiness.md) — central pre-evaluation checklist and document map.
- [Meaningful Change Review Guide](./meaningful-change-review.md) — what counts as substantive, complete SDK work.
- [Testing](./testing.md) — unit/integration lanes and the offline test guarantee.
- [Pre-PR Verification](./pre-pr-verification.md) — local CI-parity and acceptance reminders.
- [Acceptance Criteria Traceability](./acceptance-criteria-traceability.md) — evidence mapping required in PR descriptions.
- [Contributor Self-Review Form](../.github/checklists/contributor-self-review.template.md) — contributor checklist before review.
- [Contribution Quality Gate](./contribution-quality-gate.md) — maintainer approval checklist.

The goal is predictable evaluation: contributors know what evidence is required, maintainers can review against the issue rather than assumptions, and payment discussions stay separate from technical acceptance.
