# CI/CD Pipeline

This document describes the continuous integration and delivery pipeline for digital-trust-common-service. It covers trigger behavior, image and chart publishing strategies, required secrets, notifications, and deferred scope.

## Trigger Matrix

| Event | Workflows / Jobs Activated |
|-------|---------------------------|
| `pull_request` | ci-checks (lint, build, test, helm) |
| `push` to `main` | ci-checks → publish-image → deploy-dev → notify-teams |
| `push` tag `v*` | ci-checks → publish-image → publish-chart → notify-teams |

**How it works:**

- **Pull requests** run CI checks in this pipeline; no notifications are sent. Non-draft PRs additionally publish PR-scoped preview images (`pr-<N>`, `pr-<N>-<short-sha>`) and may deploy an ephemeral review environment via the separate `pr-deploy.yml` workflow — see [PR Environments](#pr-environments).
- **Pushes to `main`** (merge commits) run CI checks, then build and publish a multi-arch container image to GHCR, then deploy it to the dev environment via `helm upgrade`, then notify the team via Teams.
- **Version tags** (`v1.2.3`, `v2.0.0`, etc.) run CI checks, publish the container image with semver tags, package and publish the Helm chart as an OCI artifact, then notify the team.

CI checks always gate downstream jobs — if lint, build, or test fails, no artifact is published.

## Image Tagging Strategy

Images are published to `ghcr.io/bcgov/digital-trust-common-service`.

| Trigger | Tags Produced | Behavior |
|---------|--------------|----------|
| Push to `main` | `sha-<7char>`, `main` | `sha-<7char>` is immutable (one digest per commit). `main` is a moving tag that always points to the latest successful build from the default branch. |
| Push `v*` tag | `sha-<7char>`, `<major>.<minor>.<patch>`, `<major>.<minor>`, `latest` | The commit-pinned `sha-<7char>` tag is produced on every non-PR build alongside the semver tags. Full semver is immutable for that release. `<major>.<minor>` and `latest` are moving tags that advance with each new release. |

**Examples:**

- Merge commit `abc1234` to main → tags `sha-abc1234` + `main`
- Tag `v1.2.3` (commit `abc1234`) → tags `sha-abc1234` + `1.2.3` + `1.2` + `latest`

The image is built for both `linux/amd64` (OpenShift, CI runners) and `linux/arm64` (Apple Silicon local dev) and published as a single manifest list.

## Required Secrets

| Secret | Purpose | Rotation |
|--------|---------|----------|
| `GITHUB_TOKEN` | Authenticates to GHCR for pushing container images and Helm chart OCI artifacts | Auto-rotated by GitHub at the start of each workflow run — no manual action needed |
| `TEAMS_WEBHOOK_URL` | Delivers Adaptive Card notifications to the team's Microsoft Teams channel | Manual rotation via Power Automate; update the repository secret when the webhook URL changes |
| `OPENSHIFT_SERVER` | API URL of the OpenShift Silver cluster, used by `deploy-dev` to deploy pushes to `main` | Static; platform-provided |
| `OPENSHIFT_TOKEN` | Token of the dev-namespace pipeline ServiceAccount, used by `deploy-dev` | Regenerate SA token; update repository secret |
| `OPENSHIFT_NAMESPACE` | `<license-plate>-dev` namespace name, used by `deploy-dev` | Static |

`GITHUB_TOKEN` is automatically available in all workflows. `TEAMS_WEBHOOK_URL` must be configured as a repository secret by a maintainer with admin access. The `OPENSHIFT_*` secrets are the same ones used by the PR-environment pipeline (see [Required Secrets and Variables](#required-secrets-and-variables) below).

## Chart Publishing

The Helm chart is published as an OCI artifact to `oci://ghcr.io/bcgov/charts/digital-trust-common-service`.

**Key behaviors:**

- Published **only on `v*` tags** — pushes to `main` do not produce a chart artifact.
- Version is derived from the git tag by stripping the `v` prefix (e.g., `v1.2.3` → chart version `1.2.3`). Both `version` and `appVersion` in `Chart.yaml` are set to this value.
- Before publishing, the chart is validated with `helm lint` and `helm template` against default values. If either check fails, the job fails before any push occurs.
- Dependencies are resolved via `helm dependency build` before packaging.
- If the chart directory (`charts/digital-trust-common-service/`) does not exist, the pipeline gracefully skips chart publishing and remains green. This allows `cd.yml` to merge before the chart PR without breaking builds.

**Why a separate `/charts/` GHCR path?**

Both the container image and the Helm chart use semver as OCI tags (e.g., `1.2.3`). If they shared the same GHCR repository, tag `1.2.3` would collide — one artifact would overwrite the other. The separate `ghcr.io/bcgov/charts/digital-trust-common-service` path avoids this namespace collision entirely.

## Teams Notifications

The pipeline posts an Adaptive Card to Microsoft Teams on both success and failure outcomes.

**Card contents:**

- Pipeline status (success / failure) with color accent (green / red)
- Repository name
- Git ref (branch or tag)
- Commit SHA (7-character short form)
- Image reference (if published)
- Chart version (if published)
- Actor (who triggered the run)
- Link to the workflow run

**Graceful degradation:**

- If `TEAMS_WEBHOOK_URL` is **not set or empty**, the notification step logs a warning and exits with code 0. The pipeline stays green.
- If the webhook POST returns a **non-2xx response or times out** (30-second limit), the error is logged but the step exits with code 0. Notification failures never fail the pipeline.

## Fork Behavior

Publish jobs are guarded with `if: github.repository_owner == 'bcgov'`. Forks cannot push images or charts to the bcgov GHCR namespace. CI checks still run on fork PRs via the `ci.yml` workflow.

## Concurrency

- **CD pipeline (`cd.yml`):** Concurrency group `cd-<ref>` with `cancel-in-progress: false`. Concurrent pushes to the same ref queue rather than cancel, preventing half-pushed state (e.g., image pushed but chart or notification abandoned).
- **CI workflow (`ci.yml`):** Concurrency group `ci-<ref>` with `cancel-in-progress: true`. Superseded PR pushes cancel stale runs since nothing is published.

## Bootstrapping dev, test, and prod

The pipelines deploy the chart; they never create application data. A hosted
environment is brought up once, by hand, in this order:

1. Pre-provision the Secrets the overlay names: database credentials
   (`secret.existingSecret`), connector-encryption keys, the OIDC signing JWKS
   and the upstream federation JSON. The migration hook Job reads the database
   Secret before any release resource exists, which is why that one must
   pre-exist rather than be chart-created.
2. Register the environment's Keycloak client with `https://<host>/oidc/callback`
   as a valid redirect URI and put its credentials in the upstream federation
   Secret.
3. Deploy (dev: push to `main`). The hosted overlays enable the migration
   hook Job, so the empty database is migrated before the pods roll.
4. Run the bootstrap CLI once from an API pod — see
   [DEVELOPER.md](DEVELOPER.md#bootstrapping-a-hosted-environment). It creates
   the operator tenant, the SPA's `dtsc-ui` client with that environment's
   redirect URIs, and a platform-admin client whose secret is printed once.
5. Everything else — tenants, invitations, consumers' clients — goes through
   the API with the platform-admin client's token.

## Deferred: Phase 2 Scope

Deploying to the dev environment on pushes to `main` (`deploy-dev` job in `cd.yml`, via `oc-setup` + `helm upgrade`) is already implemented. The following capabilities are still **not implemented** and are planned for a future phase:

- **ArgoCD wiring** for test and production environments via a separate gitops repository
- **OpenShift sealed secrets management** for environment-specific configuration
- **Automatic rollback** on failed health checks after deployment

These will be added once the gitops repository structure is established.

## PR Environments

Ephemeral review environments are deployed for every non-draft pull request against `main`. Each PR gets an isolated Helm release, a dedicated database, and a unique URL in the team's dev namespace on OpenShift Silver.

### Trigger Matrix

| Event | Types | Workflow | Effect |
|-------|-------|----------|--------|
| `pull_request` | `opened`, `synchronize`, `reopened`, `ready_for_review` | `pr-deploy.yml` | Build PR image → provision database → deploy release → post comment |
| `pull_request` | `closed`, `converted_to_draft` | `pr-cleanup.yml` | Uninstall release → drop database → delete image tags → update comment |

Documentation-only changes (`docs/**`, `**/*.md`) skip the deploy workflow. The cleanup workflow has no path filter — it always runs on close/draft to ensure teardown even if the PR never deployed.

### Naming Scheme

| Resource | Pattern | Example (PR #42) |
|----------|---------|------------------|
| Helm release | `pr-<N>-digital-trust-common-service` | `pr-42-digital-trust-common-service` |
| Route URL | `pr-<N>-digital-trust-common-service-dev.apps.silver.devops.gov.bc.ca` | `pr-42-digital-trust-common-service-dev.apps.silver.devops.gov.bc.ca` |
| Image tags | `pr-<N>` (moving) + `pr-<N>-<short-sha>` (immutable) | `pr-42` + `pr-42-a1b2c3d` |
| Database | `dc_pr_<N>` | `dc_pr_42` |
| Instance label | `app.kubernetes.io/instance=pr-<N>-digital-trust-common-service` | — |

### Lifecycle

1. **PR opened / updated** — the deploy workflow builds amd64-only API and UI images tagged `pr-<N>-<short-sha>` (the UI with `VITE_AUTH_MODE=oidc`, so the preview signs in for real), creates the database `dc_pr_<N>` idempotently on the shared dev PostgreSQL, and runs `helm upgrade --install` with the in-repo chart and `values-pr.yaml` overlay. That overlay enables the migration hook Job, which brings the empty PR database to the current schema before the pods roll, and `SEED_ON_START`, so the API seeds the demo tenants and registers the UI's OIDC client with redirect URIs on the PR's own route (derived from `OIDC_ISSUER`). A sticky PR comment is posted (or updated) with the environment URL, health endpoint, image tag, and commit SHA.
2. **Subsequent pushes** — the same workflow re-runs. The immutable image tag changes (new commit SHA), so Kubernetes rolls the pods naturally. The sticky comment is updated in place.
3. **PR converted to draft** — triggers the cleanup workflow, tearing everything down.
4. **PR marked ready** — triggers `ready_for_review`, re-deploying the environment.
5. **PR closed / merged** — the cleanup workflow uninstalls the Helm release, deletes leftover objects by label selector, drops the database with `DROP DATABASE ... WITH (FORCE)`, and deletes `pr-<N>*` image tags from GHCR.

### Preflight Gate

Both workflows include a `preflight` job, but the checks differ:

- **`pr-deploy.yml`** checks repository ownership (`bcgov`), fork status, and whether the PR is a draft; maps `OPENSHIFT_SERVER`, `OPENSHIFT_TOKEN`, and `OPENSHIFT_NAMESPACE` into env vars and tests they are non-empty; exposes `build` and `deploy` outputs that gate all downstream jobs.
- **`pr-cleanup.yml`** only checks repository ownership (no fork or draft check — cleanup always runs on close/draft regardless) and the same three OpenShift secrets; it exposes only a `deploy` output (there is no image build on cleanup, so no `build` output exists).

When deploy secrets are missing, cluster jobs are skipped with a notice — the workflow run stays green. The image build (deploy workflow) requires only eligibility, not deploy secrets, so PR images are still published before cluster infrastructure exists.

### Required Secrets and Variables

| Name | Kind | Purpose | Rotation |
|------|------|---------|----------|
| `OPENSHIFT_SERVER` | Secret | API URL of the OpenShift Silver cluster | Static; platform-provided |
| `OPENSHIFT_TOKEN` | Secret | Token of the dev-namespace pipeline ServiceAccount | Regenerate SA token; update repository secret |
| `OPENSHIFT_NAMESPACE` | Secret | `<license-plate>-dev` namespace name | Static |
| `GITHUB_TOKEN` | Built-in | GHCR push/delete, PR comments, deployments | Auto-rotated per run |
| `PR_DB_WORKLOAD` | Variable | Kubernetes workload ref of the PR PostgreSQL instance (e.g. `statefulset/digital-trust-common-service-pr-db`), used for `oc exec` provisioning | Update if the PR DB workload changes |
| `PR_DB_HOST` | Variable | Optional override for the app's `config.DB_HOST` in PR releases; when unset, the `DB_HOST` default baked into `values-pr.yaml` applies | Update if the PR DB Service name changes |
| `PR_DB_OWNER` | Variable | PostgreSQL role owning `dc_pr_<N>` databases (matches `digital-trust-common-service-pr-secret`'s `DB_USERNAME`; defaults to `app` when unset) | Update if the application DB user changes |

### External Prerequisites

These are **not** provisioned by the pipeline and must exist before PR environments can fully deploy:

1. **PR PostgreSQL instance** — a dedicated PostgreSQL instance in the dev namespace (`digital-trust-common-service-pr-db`) shared by all PR environments. The `PR_DB_WORKLOAD` variable points at its workload (for `oc exec` provisioning); the app connects to its Service via the `DB_HOST` default in `values-pr.yaml` (or the `PR_DB_HOST` override). Superuser access happens only inside the pod via `oc exec`, connecting as the fixed `postgres` superuser (the official postgres image's default; no `POSTGRES_USER` env var is set on the pod) — no database password is stored in GitHub. Until provisioned, the pr-database action skips gracefully. The instance also needs an ingress NetworkPolicy admitting pods labeled `app.kubernetes.io/name: digital-trust-common-service` on 5432 (the namespace is deny-by-default).
2. **Application Secret** — a pre-provisioned Secret named `digital-trust-common-service-pr-secret` in the dev namespace containing `DB_USERNAME` and `DB_PASSWORD` for the shared application role. PR releases reference it via `secret.existingSecret` in `values-pr.yaml`; the role itself must exist on the PR PostgreSQL instance (the pipeline creates databases, never roles).
3. **Pipeline ServiceAccount** — an OpenShift ServiceAccount in the dev namespace with permissions to manage Helm release objects and `oc exec` into the database pod. Its token is stored in `OPENSHIFT_TOKEN`.
4. **GHCR package Admin role** — deleting versions of the org-owned `digital-trust-common-service` package with `GITHUB_TOKEN` requires this repository to have the Admin role in the package's *Manage Actions access* settings; without it the `clean-ghcr` job fails with a 403 and PR tags accumulate.
5. **Upstream federation Secret** — `dtsc-pr-oidc-client` in the dev namespace (referenced by `upstreamFederation.existingSecret` in `values-pr.yaml`), whose Keycloak client must accept the PR routes' `/oidc` callback as a valid redirect URI. The chart never creates this Secret.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Isolated Helm release per PR** (not a namespace per PR) | BC Gov Silver provides fixed namespaces (tools/dev/test/prod). Per-PR namespace creation is not permitted. An isolated release with a unique name and route achieves the same review isolation within the shared dev namespace. |
| **Per-PR database** (not a schema prefix) | The application configures only `DB_NAME` in its TypeORM DataSource — there is no schema-selection support. A separate database provides stronger isolation with zero application code changes. |

### Concurrency

The two workflows use **separate** concurrency groups:

- **`pr-deploy.yml`**: group `pr-env-<N>` with `cancel-in-progress: true` — a new push cancels any in-flight deploy for the same PR.
- **`pr-cleanup.yml`**: its own group `pr-env-cleanup-<N>` with `cancel-in-progress: false` — teardown runs are never cancelled, so a reopen's deploy can't interrupt an in-progress teardown mid-way and leak resources.

The reverse direction — a close/draft event arriving while a deploy is still running — is handled explicitly, not by the concurrency mechanism: `pr-cleanup.yml`'s preflight job cancels any queued or in-progress `pr-deploy.yml` runs for the PR's branch via `gh run cancel` before teardown proceeds.

Cleanup steps are idempotent (safe to re-run).
