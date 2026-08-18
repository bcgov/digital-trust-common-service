---
applyTo: 'charts/**,.github/workflows/**'
description: Helm chart, deployment surface, and CI workflow rules.
---

# Helm chart and CI

## Every chart change

1. Regenerate `charts/digital-trust-common-service/README.md` with helm-docs. CI runs
   `git diff --exit-code` on it, so a stale README fails the build.
2. Add an entry to `charts/digital-trust-common-service/CHANGELOG.md` — Keep a Changelog 1.1.0 and
   SemVer. This changelog covers the chart only; there is no application-level changelog.
3. Keep the README regeneration and CHANGELOG entry in the same commit as the template change.

## Validate locally, the way CI does

`.mise.toml` pins helm, helm-docs, actionlint, and yamllint at the versions `ci-checks.yml` uses, so
`mise install` gets you a matching toolchain. Bumping a version means changing both files.

```bash
helm lint charts/digital-trust-common-service
helm template charts/digital-trust-common-service \
  --set-file oidcSigning.keys=charts/digital-trust-common-service/ci/placeholder-oidc-keys.json
helm unittest charts/digital-trust-common-service
yamllint --strict -c .yamllint charts/digital-trust-common-service
actionlint                       # when touching .github/workflows
```

`helm lint` and `helm template` run against every overlay: `values.yaml`, `values-dev.yaml`,
`values-test.yaml`, `values-prod.yaml`, `values-pr.yaml`, and `ci/ci-values.yaml`.

## Deployment surface

Values, templates, and code must agree in both directions.

- A key referenced in `configmap.yaml`, `secret.yaml`, `deployment.yaml`, or
  `worker-deployment.yaml` must exist in `values.yaml` with a default and a helm-docs comment.
- A new env var or mounted path in code must reach `.env.example`, `docker-compose.yml`, the values
  files, the configmap or secret, **both** `deployment.yaml` and `worker-deployment.yaml`, and
  `migration-job.yaml` where relevant. The worker deployment is the one that gets missed — the
  application starts fine and the background jobs quietly misbehave.
- Mounted files need matching `volumes`/`volumeMounts` in both deployments plus a backing Secret or
  ConfigMap. Follow `oidc-signing-secret.yaml` and `connector-encryption-secret.yaml`.
- Assert new required keys in `charts/digital-trust-common-service/tests/` (helm unittest).
- Sensitive values arrive via `--set-file` or external secret injection. Never commit key material,
  passwords, or client secrets to a `values-*.yaml`.

The full checklist is in `.github/copilot-instructions.md`.

## Pipeline conventions

From `docs/cicd.md`:

- PRs target `main`. CI gates are lint, build, test, and helm.
- Push to `main` publishes `sha-<7char>` and `main` image tags and deploys to dev.
- A `v<major>.<minor>.<patch>` tag publishes the image and the chart; chart version and appVersion
  drop the leading `v`. Charts go to a separate OCI path from images.
- PR environments use release `pr-<N>-digital-trust-common-service` and database `dc_pr_<N>`.
  Docs-only changes skip the PR deploy.
- Publish jobs are guarded by `github.repository_owner == 'bcgov'`.

Reference the work-item code (`AU-01`, `AG-01`, `IN-11`, …) in commit footers and PR descriptions,
matching existing practice.
