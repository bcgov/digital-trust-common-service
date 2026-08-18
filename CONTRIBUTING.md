# Contributing

Thanks for contributing to the digital trust common service.

This guide covers the human workflow. The conventions themselves live in
[.github/copilot-instructions.md](.github/copilot-instructions.md) and
[.github/instructions/](.github/instructions/) — those files are the source of truth for both people
and AI agents, so they are not duplicated here.

## Getting set up

Requires Node 24 (pinned in `.mise.toml`), npm, and Docker.

```bash
npm ci                    # also installs the git hooks via husky
cp .env.example .env
docker compose up -d db
npm run build && npm run migrate:up
npm run seed
npm run start:dev
```

`docs/DEVELOPER.md` covers local HTTPS through Caddy, seeding, and troubleshooting.
`docs/ARCHITECTURE.md` explains why the service is built the way it is.

## Working on a change

```bash
npm run lint:ci    # CI gate; npm run lint autofixes
npm run build
npm test
```

Integration and e2e tests need a database:

```bash
docker compose --profile test up -d db-test migrate-test seed-test
npm run test:integration
npm run build && npm run migrate:up && npm run test:e2e
```

Schema changes go through `npm run migration:create`. Never edit a migration that is already
registered in `libs/database/src/data-source.ts` — it has already run in dev, test, and PR
environments.

Adding or renaming an environment variable or a mounted path means updating `.env.example`,
`docker-compose.yml`, the Helm values, and **both** the app and worker deployment templates in the
same change. The full checklist is in the Copilot instructions.

## Branches and pull requests

- Branch off `main`; PRs target `main`.
- CI runs lint, commit-message, build, test, and helm checks. All must pass.
- On your own branch, amend and rebase freely to keep history reviewable, and prefer
  `git push --force-with-lease`. Never rewrite history on `main` or a published release tag.
- Never use `--no-verify`.

## Commit messages

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), enforced by commitlint
through a `commit-msg` hook locally and the `commits` job in CI.

```
feat(auth): add token introspection endpoint

Client credentials tokens could not be validated by downstream services
without calling the JWKS endpoint directly.

Refs #123
```

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`,
  `revert`.
- Scope is optional, but must come from the list in `commitlint.config.mjs` when present.
- The header is 72 characters or fewer, imperative, lowercase, no trailing period.
- The body explains why. The footer carries `BREAKING CHANGE:`, the work-item code (`AU-01`,
  `AG-01`, …), and `Refs #<issue>`.
- Sign off with `git commit --signoff`. Recommended rather than required — it certifies the
  Developer Certificate of Origin, which is standard practice across BC Gov repositories.

Keep each commit to one logical change that builds, lints, and tests green on its own. Stage
explicitly with `git add <paths>` rather than `git add -A`, so unrelated work in your tree does not
ride along.

## Definition of done

1. `npm run lint:ci`, `npm run build`, and `npm test` pass.
2. Specs added or extended for the changed behaviour.
3. Swagger decorators updated for any API surface change.
4. Config propagation checklist satisfied.
5. `docs/` updated when behaviour, architecture, or the developer workflow changes.
6. Chart changes carry a regenerated helm-docs README and a CHANGELOG entry.

## Security

Do not open a public issue for a security vulnerability, and never commit keys, tokens, passwords,
or client secrets. Report privately to the maintainers.
