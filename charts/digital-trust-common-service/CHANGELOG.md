# Changelog

All notable changes to the `vc-common-service` Helm chart are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this chart adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- Initial Helm chart for deploying vc-common-service to BC Gov OpenShift.
- API Deployment with templated resources and liveness/readiness probes on
  `/health/live`.
- Database migrations as a `pre-install`/`pre-upgrade` Helm hook Job (gated by
  `migrations.enabled`).
- Worker Deployment sharing the same image with entrypoint `node dist/worker.js`
  and an independent HPA (gated by `worker.enabled`).
- Service and OpenShift Route (default) with an optional Kubernetes Ingress.
- ConfigMap for non-secret configuration and a Secret that references a
  pre-provisioned Secret by default.
- NetworkPolicies: router ingress to the API, explicit egress to PostgreSQL and
  Keycloak, plus a DNS-allow policy.
- Independent HPAs for the API and Worker.
- Per-environment values files (`values-dev.yaml`, `values-test.yaml`,
  `values-prod.yaml`) and `ci/ci-values.yaml`.
- Generated `README.md` (via helm-docs).
