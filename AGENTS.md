# AGENTS.md

Instructions for AI coding agents working in this repository.

The full guidance lives in [.github/copilot-instructions.md](.github/copilot-instructions.md), with
path-scoped rules in [.github/instructions/](.github/instructions/) covering NestJS modules, the
database layer, testing, auth and crypto, and the Helm chart. Read those before making changes.

The rules that must never be broken:

- **Tenant isolation is application-enforced.** There is no Postgres row-level security, so never
  remove or weaken a `tenantId` filter.
- **Migrations are immutable.** Never edit one already registered in
  `libs/database/src/data-source.ts`; create a new one with `npm run migration:create`.
- **Never weaken crypto or leak secrets.** No changes to argon2 hashing, the AES-256-GCM envelope,
  required PKCE, or JWKS validation; no keys, tokens, or passwords committed or logged.
- **Config changes span deployment surfaces.** A new env var or mounted path must reach
  `.env.example`, `docker-compose.yml`, the Helm values, and both the app and worker deployment
  templates in the same change.
- **Done means green.** `npm run lint:ci`, `npm run build`, and `npm test` must all pass, with specs
  added for new behaviour. Never use `--no-verify`.
- **Commits are Conventional and self-contained.** `<type>(<scope>): <subject>`, enforced by
  commitlint in a `commit-msg` hook and in CI. One logical change per commit, staged explicitly with
  `git add <paths>`, preferably with `--signoff`. Never rewrite history on `main`.
