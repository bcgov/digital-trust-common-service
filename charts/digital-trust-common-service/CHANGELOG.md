# Changelog

All notable changes to the `digital-trust-common-service` Helm chart are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this chart adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- Initial Helm chart for deploying digital-trust-common-service to BC Gov OpenShift.
- API Deployment with templated resources and liveness/readiness probes on
  `/health/live`.
- Optional Frontend Deployment (React SPA + Caddy) with its own Service and
  HPA, reverse-proxying `/api`, `/oidc`, and `/health` to the API service.
- Database migrations as a `pre-install`/`pre-upgrade` Helm hook Job (gated by
  `migrations.enabled`).
- Worker Deployment sharing the same image with entrypoint `node dist/worker.js`
  and an independent HPA (gated by `worker.enabled`).
- API Service plus optional frontend Service; OpenShift Route/Ingress now target
  the frontend service when enabled (API service otherwise).
- ConfigMap for non-secret configuration and a Secret that references a
  pre-provisioned Secret by default.
- NetworkPolicies: router ingress to the API, explicit egress to PostgreSQL and
  Keycloak, plus a DNS-allow policy.
- Frontend-aware NetworkPolicies: router ingress to frontend and frontend->API
  ingress/egress rules when the UI is enabled.
- Independent HPAs for the API and Worker.
- Per-environment values files (`values-dev.yaml`, `values-test.yaml`,
  `values-prod.yaml`) and `ci/ci-values.yaml`.
- Generated `README.md` (via helm-docs).
- `config.ADAPTER_OVERRIDE_ENABLED` (default `"false"`), gating the platform-admin
  adapter override in the credential adapter registry (CA-02).
- PR environments (`values-pr.yaml`) run the migration hook Job, so a
  preview's empty database reaches the current schema before the pods roll.
- The dev, test and prod overlays run it too, so every hosted deploy migrates
  its database before the pods roll.
- Frontend runtime configuration: `frontend.config.*` is rendered into the
  frontend ConfigMap as `config.json` and mounted over the image's copy at
  `/srv/config.json`, where the SPA reads it at startup; Caddy serves it with
  `Cache-Control: no-cache` so a change reaches the next page load.

### Fixed

- The migration Job's default command pointed at a `migrate.js` that does not
  exist; it now runs the TypeORM CLI against the compiled DataSource, the
  same thing `npm run migrate:up` does.
- The migration Job depended on release resources — the ConfigMap for its
  environment and the chart-created ServiceAccount — which a `pre-install`
  hook runs before Helm has created, so a first install never started the
  pod. Non-secret settings are now rendered into the Job (an upgrade
  therefore migrates against the new values too), only the pre-provisioned
  Secret is referenced, and the hook names a ServiceAccount only when it is
  pre-existing (`serviceAccount.create: false`). A chart-managed Secret
  (`secret.create` without `secret.existingSecret`) is refused alongside a
  `pre-install` hook rather than left to time out.
