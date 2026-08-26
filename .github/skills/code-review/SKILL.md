---
name: code-review
description: "Review code, pull requests, diffs, and proposed changes for concrete defects, regressions, security and tenant-isolation risks, missing tests, unnecessary files or documentation, issue references that must not appear in code comments, and repository policy violations."
argument-hint: "Review the current diff and report actionable findings with file and line references."
---
# Code Review

## When to Use

Use this skill when the user asks for a code review, pull request review, diff review, or an assessment of proposed changes.

## Procedure

1. Read the author's stated review focus, when available, before inspecting unrelated areas. Use it to prioritize the investigation, but verify the focus against the diff rather than treating it as a substitute for review.
2. Assess the change's blast radius. Read every changed line in high-risk paths, including tenant access, authentication, authorization, cryptography, migrations, background jobs, configuration, and API contracts; skim lower-risk changes after that.
3. Inspect the diff and directly affected call paths before exploring unrelated code. Identify concrete defects, behavioral regressions, security risks, data-isolation risks, missing required configuration propagation, and missing tests.
4. Check newly added files and documentation for a demonstrated user, operator, API, architecture, or maintenance need. Flag files that duplicate existing guidance, restate code, belong in an existing document, or add no durable value. Check whether generated documentation should have been regenerated instead of hand-edited.
5. Enforce the repository policy: no issue references, issue names, or issue numbers may appear in code comments or other committed repository content. Newly introduced tracking references in source, comments, documentation, tests, fixtures, configuration, generated output, or user-facing messages are blocker findings; recommend removing them. `Closes #1234` is allowed in the PR description because it is PR metadata, not repository content.
6. Prefer commit messages that explicitly describe the change and its purpose. Flag a commit message that uses an issue number instead of explaining the change; allow a tracking reference in a commit only when genuinely necessary for traceability, compliance, release automation, or another explicit repository requirement.
7. Check new or changed comments and documentation for dates, temporary owners, or external discussions that are likely to become stale. Prefer comments that explain why non-obvious code must exist; do not require comments for self-explanatory code.
8. Check claims in comments and documentation against the implementation, tests, configuration, migrations, and supported behavior. Report drift introduced or made materially misleading by the diff.
9. Check that tests cover changed behavior and important failure paths. Flag tests that are weakened, skipped, deleted, or made less meaningful to pass.
10. When relevant, verify this repository's tenant predicates, cryptographic invariants, API versioning, strict DTO validation, migration immutability, secret handling, and configuration propagation.
11. Consider error handling, authorization, input validation, concurrency, resource cleanup, and compatibility with existing callers. Follow the nearest established repository pattern before proposing a new abstraction.
12. Keep the review focused on code and content added or edited by the PR. Do not comment on unrelated pre-existing code, documentation, tests, or configuration, and do not drag existing technical debt into the review. The only exception is a major, actionable security risk that requires immediate attention; clearly explain why it overrides the normal PR-scope boundary.
13. Do not report formatting, import order, naming preferences, behavior-preserving refactors, numeric coverage targets, or speculative concerns unless they create a concrete maintenance or correctness risk. Do not expand the review into unrelated pre-existing issues.
14. Do not automatically ignore generated files, lockfiles, or dependency changes. Review them when they affect runtime behavior, security, API compatibility, migrations, or deployment; otherwise leave them alone.
15. Before reporting a finding, inspect existing review comments and prior review summaries for this PR when available. Match possible duplicates by file, line or code region, and underlying failure mode, not only by wording.
16. Do not create a new comment for an unresolved finding when the relevant code and evidence are materially unchanged. Re-report it only when the relevant code changed, new evidence changes the analysis, the finding became more severe, or a previously dismissed finding is demonstrably still valid. Do not reopen a resolved finding unless the new diff reintroduces the problem.
17. When a finding remains valid but unchanged, summarize it without posting a duplicate inline comment. Use stable, concise finding titles so equivalent findings can be recognized across review runs.

## Backend Review

When backend code changes, check:

- Tenant predicates on every tenant-scoped read, update, and delete.
- Authentication and authorization at controller and service boundaries.
- DTO validation, unknown-field rejection, route parameter validation, and API versioning.
- Controller, service, and repository layering, including accidental cross-layer access.
- Review transactions, partial writes, idempotency, retries, resource cleanup, and background-job failure handling.
- Ensure secrets and sensitive personal data are absent from logs, errors, fixtures, and unintended responses.
- Migrations are additive and immutable, with matching entity and test changes.
- Configuration changes propagate to local, test, migration, worker, and Helm deployment surfaces.
- Swagger describes the changed API contract accurately.

## Frontend Review

When `apps/ui` changes, check:

- API calls remain in the API resource layer and use the existing generated types.
- Generated API types are regenerated rather than hand-edited.
- Requests send only fields declared by the API contract.
- Loading, error, empty, retry, and stale-data states are handled where relevant.
- Authentication preserves the existing `AuthClient` seam and mock mode behavior.
- Tenant boundaries are respected in routes, navigation, queries, and displayed data.
- Route registration, providers, and layouts follow the existing application structure.
- User-facing text meets accessibility and localization requirements and does not expose sensitive data.
- Verify responsive layouts do not overlap or break controls at supported viewport sizes.
- UI tests cover changed interactions and failure states using the existing test and mocking tools.

## Helm Chart Review

When `charts/**` changes, check:

- Values, templates, deployments, workers, migration jobs, and application configuration agree in both directions.
- New environment variables and mounted paths reach every required overlay and workload.
- Both `deployment.yaml` and `worker-deployment.yaml` are updated when applicable; do not assume the worker has the same configuration automatically.
- Sensitive values use Secrets or external injection and are not committed to values files.
- Required Helm unit-test assertions are added or updated.
- Generated `README.md` is regenerated rather than hand-edited.
- The chart `CHANGELOG.md` is updated in the same change as the template change.
- Template changes preserve tenant, authentication, secret, and operational behavior.
- Helm linting, rendering, unit tests, and YAML validation are run when available, using the repository's documented commands.

## Commit and PR Metadata

- Use Conventional Commits for every commit message and PR title: `<type>(<scope>): <subject>`, with the scope optional.
- Use only the commit types accepted by `commitlint.config.mjs`: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`, or `revert`.
- If a scope is supplied, use a scope from `commitlint.config.mjs`; do not invent a scope. Keep the header at 100 characters or fewer so it passes the configured `header-max-length` rule.
- Prefer a concise, explicit, imperative, lowercase subject with no trailing period. The subject should describe the change and its purpose; do not use an issue number as a substitute for that description.
- Prefer commit messages that explicitly describe the change and its purpose. Use an issue reference in a commit only when genuinely necessary for traceability, compliance, release automation, or another explicit repository requirement.
- `Closes #1234` is allowed in the PR description as GitHub metadata. Issue names and numbers must not appear in code comments or other committed repository content.
- When suggesting or reviewing a commit or PR title, check it with the repository's commitlint configuration rather than assuming a Conventional Commit is valid.

## Findings

- Lead with findings, ordered by severity: blocker, high, medium, then low.
- Make each finding concise and evidence-based. Include the affected file and line, explain the failure mode, and give a specific fix.
- Separate blocking defects from non-blocking suggestions. State the problem and its impact once, use calibrated language when uncertain, and prefer a few high-impact findings over many low-signal observations.
- Summarize the changed files in risk order, from highest review risk to lowest, so the author and reviewers know where to focus first.
- Separate open questions and assumptions from findings.
- After findings, summarize validation performed and mention residual test gaps or validation limits.
- If no issues are found, say so clearly and still mention remaining test gaps or residual risk.

## Repeat Findings

- Treat prior review comments as historical context, not proof that a finding is fixed. Check the current diff and code before deciding whether it remains applicable.
- Do not repeat the same concern across review runs when its location, failure mode, and supporting evidence are unchanged.
- If the review system does not expose prior comments, say that duplicate suppression could not be verified and avoid making unsupported claims about prior findings.

## Tone

- Be respectful, concise, and actionable.
- Distinguish a definite defect from a suggestion or an open question. Do not present speculative concerns as facts.
- Do not repeat the same concern in multiple findings or review runs. Prefer updating or referencing an existing finding when the review system supports it.
