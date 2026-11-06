# Changelog

All notable changes to the `digital-trust-common-service` Helm chart are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this chart adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- `logGateway` values (`enabled` default `false`) and `networkPolicy.loki` for a
  standalone Envoy in front of Loki, following the `frontend` and `worker`
  layout: ConfigMap, Deployment, Service with a serving-certificate annotation,
  re-encrypted Route, optional HPA, and NetworkPolicies limiting its egress to
  the log-access endpoint, Loki and DNS. Every route, including the catch-all,
  calls the log-access endpoint first; only the Loki read paths are routed (no
  live tail); a failed or slow decision answers the same `403` as a denial; the
  caller's `Authorization` is replaced with a Loki login read from
  `logGateway.upstream.auth.existingSecret`. The probe listener has its own
  port and is not on the Service or Route. `logAccess.gatewayPodSelector`
  defaults to the gateway's labels when the gateway is enabled. CI validates the
  rendered config with the Envoy tag from `logGateway.image.tag`. Off in every
  overlay.
- `logGateway.metrics` for monitoring the log gateway. A `metrics` listener on its own
  port (`metrics.port`, default `9102`) serves only `/stats/prometheus`, so the
  loopback admin interface stays unreachable. Optional `PodMonitor`
  (`metrics.podMonitor.enabled`) and `PrometheusRule` (`metrics.prometheusRule.enabled`),
  both default `false`, with alerts for a down gateway, unavailable replicas, decision
  endpoint failures, 5xx responses, Loki connect failures, p99 latency, a high deny rate
  and an expiring certificate. `networkPolicy.monitoring.namespaceSelector` and
  `networkPolicy.monitoring.podSelector` (default `app.kubernetes.io/name: alloy`, the
  in-namespace collector) admit the scraper to the metrics port when the `PodMonitor` is
  enabled. The `PodMonitor` adds a `release` label from the pod's instance label, and the
  alerts select and are labelled on `release`, so releases sharing a namespace stay apart.
- `networkPolicy.logGateway.ingressPeers` (default `[]`): extra peers allowed to call the
  log gateway besides the router, for example an in-cluster Grafana.
- Rendering fails when `logGateway.enabled` is true and `networkPolicy.dnsEgress.enabled` is
  false or `networkPolicy.dnsEgress.ports` is empty. Envoy finds the log-access endpoint and
  Loki by name, so without DNS every query would be refused, and a DNS rule with no ports
  would open the gateway's egress to everything.
- The log gateway drops idle connections to the log-access endpoint after 4s (it closes
  its own after about 5s, which refused some valid queries), and answers a Loki outage or
  timeout as JSON `{"error":"unavailable"}` with the status unchanged.
  `logGateway.upstream.timeout` now defaults to `65s` and `logGateway.route.annotations`
  to `haproxy.router.openshift.io/timeout: 70s`, so long queries are not cut off.
- `logAccess` values (`enabled` default `false`, `port`, `tls.mountPath`,
  `gatewayPodSelector`) and `config.LOG_GATEWAY_AUDIENCE` (default `""`) for the
  internal log-access decision endpoint that the log gateway's `ext_authz`
  filter calls. When enabled the chart adds a separate `-log-access` Service
  carrying an OpenShift serving-certificate annotation, mounts that certificate
  into the API pod, opens a TLS container port, and adds a NetworkPolicy that
  admits only pods matching `gatewayPodSelector` to it. Rendering fails if the
  selector is empty (it would admit every pod) or `networkPolicy.enabled` is
  false (nothing would restrict the port). The port is never on the main
  Service or the Route.
- `config.SEED_PLATFORM_OPERATOR_EMAILS` (default `""`), comma-separated emails
  the development seed makes owners of the demo tenant `acme-corp` with the
  platform-operator flag, so a real sign-in to a PR environment lands as owner
  and platform admin instead of `readonly`. Additive: dropping an email demotes
  nobody. `pr-deploy.yml` sets it from the `PR_ENV_OPERATOR_EMAILS` repository
  variable.
- `POD_NAME` (downward API, `metadata.name`) in the API and Worker, and
  `OTEL_RESOURCE_ATTRIBUTES` now `service.instance.id=$(POD_NAME),service.version=<tag>`
  when `otel.enabled`. Previously every pod exported into the same metric
  series, so counters and histograms were corrupted and gauges interleaved
  readings from different pods. Each pod now gets its own `instance` label,
  matching the `pod` label on its logs. Series count scales with pod count,
  and a rollout starts a fresh set.
- `config.JWT_ADDITIONAL_AUDIENCES` (default `""`), comma-separated extra
  RFC 8707 resource indicators the OIDC provider may mint access tokens for,
  such as the tenant log gateway. Previously settable only through `.env`
  locally, so the gateway audience could not be configured in a deployed
  environment. Tokens minted for these resources carry that audience alone
  and are rejected by `JwtGuard`.
- `config.CORS_ALLOWED_ORIGINS` (default `""`), a comma-separated list of
  exact allowed CORS origins, or `"*"` (refused when `NODE_ENV=production`).
  No safe chart-wide default: `values-dev.yaml`, `values-test.yaml`,
  `values-prod.yaml`, and `values-pr.yaml`, each set
  their own.
- `config.APP_PUBLIC_URL` (default `""`), the app's own externally-reachable
  origin (no path). Replaces `OIDC_ISSUER`: `OidcConfigService` now derives
  the OIDC issuer as `${APP_PUBLIC_URL}/oidc` and throws at startup if unset
  in production. Set per environment in `values-dev.yaml`, `values-test.yaml`,
  and `values-prod.yaml`.
- `otel.logsExporter` (default `none`), rendered as `OTEL_LOGS_EXPORTER` into
  the API and Worker. Previously omitted on the assumption that leaving it
  unset meant logs were not exported; the OpenTelemetry SDK defaults it to
  `otlp`, so the pino instrumentation was posting every log line to the
  collector's `/v1/logs` in addition to stdout, which Alloy already ships to
  Loki. Setting it to `none` explicitly removes the duplicate path and leaves
  trace correlation intact.
- Initial Helm chart for deploying digital-trust-common-service to BC Gov OpenShift.
- API Deployment with templated resources, a liveness/startup probe on
  `/health/live` and a readiness probe on `/health/ready`.
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
- Per-tenant rate limiting config: `config.RATE_LIMIT_ENABLED` (default
  `"true"`), `config.RATE_LIMIT_WINDOW_MS`, `config.RATE_LIMIT_GLOBAL_PER_MINUTE`,
  `config.RATE_LIMIT_STANDARD_PER_MINUTE`, `config.RATE_LIMIT_PREMIUM_PER_MINUTE`,
  `config.RATE_LIMIT_PRUNE_CRON`, and `config.RATE_LIMIT_HIT_RETENTION_MINUTES`.
- PR environments (`values-pr.yaml`) run the migration hook Job, so a
  preview's empty database reaches the current schema before the pods roll.
- The dev, test and prod overlays run it too, so every hosted deploy migrates
  its database before the pods roll.
- Frontend runtime configuration: `frontend.config.*` is rendered into the
  frontend ConfigMap as `config.json` and mounted over the image's copy at
  `/srv/config.json`, where the SPA reads it at startup; Caddy serves it with
  `Cache-Control: no-cache` so a change reaches the next page load.
- PR environments (`values-pr.yaml`) run the migration hook Job and the
  development seed on start, so a preview signs in for real against its own
  `/oidc` provider.
- OpenTelemetry export config: an `otel:` block (`enabled`, `endpoint`,
  `protocol`, `apiServiceName`, `workerServiceName`, `tracesExporter`,
  `metricsExporter`) renders `OTEL_*` environment variables into the API and
  Worker deployments when enabled, with the API and Worker reporting under
  different `OTEL_SERVICE_NAME` values. Rendering fails when `otel.enabled` is
  true and `otel.endpoint` is empty, rather than letting the SDK silently drop
  telemetry against `localhost:4318`. Both deployments also report
  `service.version` from the deployed image tag, so a trace can be tied to a
  build. `networkPolicy.collector` adds the matching egress rule to the OTLP
  collector for the API and Worker.
- The dev and PR environment overlays enable OTel export to the platform
  collector and its egress rule, so preview deploys exercise the path to the
  collector rather than leaving it untested until a release. PR deploys report
  a per-PR `OTEL_SERVICE_NAME` (injected by `pr-deploy.yml`), since previews
  share a namespace and a `NODE_ENV` with dev.
- `networkPolicy.collector` is now implied by `otel.enabled`, so turning OTel on
  cannot leave the exporter blocked. The database and Keycloak rules already
  isolate the pods' egress, and a missing collector rule dropped every span and
  metric with no error anywhere. This mirrors how `dnsEgress` is derived from
  the other egress rules for the same reason.

### Fixed

- `DB_LOGGING` accepts TypeORM log levels, not just a boolean, and the dev and
  PR overlays now request `error,warn,migration` instead of `true`. Logging every
  statement meant the readiness probe's `SELECT 1` was roughly 70% of those
  environments' log volume — and those lines are not JSON, so they defeated log
  parsing as well as burying everything else.

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
