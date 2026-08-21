## What

<!-- What changed, in a sentence or two. -->

## Why

<!-- The problem this solves. Link the work-item code (AU-01, AG-01, …) and Refs #<issue>. -->

## Checklist

- [ ] `npm run lint:ci`, `npm run build`, and `npm test` pass
- [ ] Specs added or extended for the changed behaviour
- [ ] Swagger decorators updated for any API surface change
- [ ] Commits are Conventional, self-contained, and signed off
- [ ] Env var or mounted path changes reach `.env.example`, `docker-compose.yml`, the Helm values,
      and **both** the app and worker deployment templates
- [ ] Chart changes include a regenerated helm-docs README and a CHANGELOG entry
- [ ] `docs/` updated when behaviour, architecture, or the developer workflow changes
- [ ] No secrets, keys, or tokens added to code, values files, fixtures, tests, or logs
- [ ] Tenant-scoped queries still filter on `tenantId`

## Notes for reviewers

<!-- Anything worth a close read, or deliberately left out of scope. -->
