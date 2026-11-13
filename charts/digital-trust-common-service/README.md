# digital-trust-common-service

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.0.1](https://img.shields.io/badge/AppVersion-0.0.1-informational?style=flat-square)

A Helm chart to deploy the Digital Credential Common Service (NestJS) on BC Gov OpenShift

## Prerequisites

- Kubernetes 1.25+ / OpenShift 4.12+
- Helm 3.8.0+
- An external PostgreSQL database and (optionally) a Keycloak instance
- A pre-provisioned `Secret` with database credentials (or set `secret.create=true`;
  `migrations.enabled` needs the pre-provisioned one)
- A pre-provisioned upstream federation `Secret` for every deployment environment, referenced by `upstreamFederation.existingSecret.name` (the chart does not create this secret)

## Installing the Chart

```console
helm install digital-trust-common-service ./charts/digital-trust-common-service \
  -n <namespace> \
  -f charts/digital-trust-common-service/values-dev.yaml
```

The [Values](#values) section lists all configurable parameters.

## Architecture

This chart deploys the Digital Credential Common Service (a NestJS modular monolith) to BC Gov
OpenShift. Key characteristics:

- **API Deployment** — HTTP service on container port `3000`; liveness probe on
  `/health/live`, readiness probe on `/health/ready`.
- **Frontend Deployment** — React SPA served by Caddy, reverse-proxying `/api`,
  `/oidc`, and `/health` to the API service for same-origin browser traffic.
- **Migrations** — run as a `pre-install`/`pre-upgrade` Helm hook Job (same image,
  overridden command), gated by `migrations.enabled`. Running once per release
  (rather than as a per-pod init container) avoids concurrent migration runs
  across replicas and HPA scale-ups. Set `migrations.argocd.enabled=true` to also
  emit a `PreSync` hook for ArgoCD/GitOps.
- **Worker Deployment** — the same image with entrypoint `node dist/worker.js`
  and its own HPA, gated by `worker.enabled`.
- **Exposure** — an OpenShift `Route` by default; a Kubernetes `Ingress` is an
  optional alternative.
- **External dependencies** — PostgreSQL and Keycloak are treated as external,
  shared services (consumed via env vars and a `Secret`).
- **NetworkPolicies** — restrict ingress to the OpenShift router and declare
  explicit egress to PostgreSQL/Keycloak, with a DNS-allow policy so hostname
  resolution keeps working once egress rules are in effect.

## Upstream Federation Secret

The `upstreamFederation` configuration is always consumed from an existing Kubernetes Secret.

- The chart never creates this Secret.
- You must pre-provision it in every deployment environment (dev, test, prod, pr, ci).
- Set `upstreamFederation.existingSecret.name` to that Secret, and
  `upstreamFederation.existingSecret.key` to the JSON key containing the upstream IdP client config.

## Pre-provisioned Secret Examples

Several chart values point at existing Kubernetes Secrets rather than creating them automatically. The examples below show the expected structure and key names with placeholder values.

### Database Credentials Secret

Referenced by `secret.existingSecret`.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: digital-trust-common-service-secret
type: Opaque
stringData:
  DB_USERNAME: <database-username>
  DB_PASSWORD: <database-password>
```

### Upstream Federation Secret

Referenced by `upstreamFederation.existingSecret.name` and `upstreamFederation.existingSecret.key`.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: dtsc-dev-oidc-client
type: Opaque
stringData:
  upstream-identity-federation.json: |
    {
      "url": "https://<keycloak-or-idp-host>/realms/<realm>",
      "clientId": "<upstream-client-id>",
      "clientSecret": "<upstream-client-secret>"
    }
```

### Connector Encryption Secret

Referenced by `connectorEncryption.existingSecret`.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: digital-trust-common-service-dev-connector-encryption
type: Opaque
stringData:
  encryption-keys.json: |
    {
      "currentVersion": 1,
      "keys": {
        "1": "<64-char-hex-aes256-key>"
      }
    }
```

This Secret is mounted at `/etc/connector`, so the JSON key name should match the filename implied by `CONNECTOR_ENCRYPTION_KEYS_PATH` unless you also override that path.

### OIDC Signing Secret

Referenced by `oidcSigning.existingSecret`.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: digital-trust-common-service-dev-oidc-signing
type: Opaque
stringData:
  oidc-keys.json: |
    {
      "keys": [
        {
          "kty": "RSA",
          "kid": "<key-id>",
          "use": "sig",
          "alg": "RS256",
          "n": "<base64url-modulus>",
          "e": "AQAB",
          "d": "<base64url-private-exponent>",
          "p": "<base64url-prime-p>",
          "q": "<base64url-prime-q>",
          "dp": "<base64url-dp>",
          "dq": "<base64url-dq>",
          "qi": "<base64url-qi>"
        }
      ]
    }
  OIDC_COOKIE_KEYS: <comma-separated-cookie-signing-secrets>
```

Generate the JWKS payload with `npm run oidc:generate-keys > oidc-keys.json`, then copy that file content into the `oidc-keys.json` entry above.

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| bcgov |  | <https://github.com/bcgov> |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` | Affinity for API pods |
| autoscaling.enabled | bool | `false` | Enable autoscaling for the API Deployment |
| autoscaling.maxReplicas | int | `3` | Maximum API replicas |
| autoscaling.minReplicas | int | `1` | Minimum API replicas |
| autoscaling.targetCPUUtilizationPercentage | int | `80` | Target average CPU utilization (percentage) |
| config | object | `{"ADAPTER_OVERRIDE_ENABLED":"false","APP_PUBLIC_URL":"","AUDIT_AUTO_INTERCEPTOR_ENABLED":"false","AUDIT_PARTITION_CRON":"0 3 * * *","AUDIT_PARTITION_MONTHS_AHEAD":"3","CONNECTOR_ENCRYPTION_KEYS_PATH":"/etc/connector/encryption-keys.json","CORS_ALLOWED_ORIGINS":"","DB_HOST":"","DB_LOGGING":"false","DB_NAME":"dc_common_service","DB_PORT":"5432","DB_SYNCHRONIZE":"false","JWT_ADDITIONAL_AUDIENCES":"","JWT_AUDIENCE":"https://digital-trust-common-service","LOG_GATEWAY_AUDIENCE":"","LOG_LEVEL":"info","NODE_ENV":"production","OIDC_GRANT_TYPES":"client_credentials,authorization_code,refresh_token","OIDC_KEYS_PATH":"/etc/oidc/oidc-keys.json","PORT":"3000","RATE_LIMIT_ENABLED":"true","RATE_LIMIT_GLOBAL_PER_MINUTE":"2000","RATE_LIMIT_HIT_RETENTION_MINUTES":"5","RATE_LIMIT_PREMIUM_PER_MINUTE":"1000","RATE_LIMIT_PRUNE_CRON":"0 * * * *","RATE_LIMIT_STANDARD_PER_MINUTE":"100","RATE_LIMIT_WINDOW_MS":"60000","SEED_PLATFORM_OPERATOR_EMAILS":"","SWAGGER_ENABLED":"true","SWAGGER_JSON_ENABLED":"true"}` | Non-secret application configuration, rendered into a ConfigMap and injected as environment variables into all containers. |
| config.APP_PUBLIC_URL | string | `""` | This app's own externally-reachable origin, no path (e.g. https://api.example.com). Required in production: OidcConfigService throws at startup if unset. The OIDC provider is mounted at `${APP_PUBLIC_URL}/oidc`. |
| config.CORS_ALLOWED_ORIGINS | string | `""` | Comma-separated list of exact allowed CORS origins, or "*" (refused when NODE_ENV is production). No safe chart-wide default: every environment overlay sets its own. |
| config.JWT_ADDITIONAL_AUDIENCES | string | `""` | Comma-separated extra RFC 8707 resource indicators the OIDC provider may mint access tokens for (downstream gateways, e.g. the tenant log gateway). Each must be an absolute URI without a fragment. A token resolves to exactly one audience, and tokens minted for these resources are rejected by JwtGuard by design. |
| config.LOG_GATEWAY_AUDIENCE | string | `""` | Audience the internal log-access endpoint accepts. Must be one of JWT_ADDITIONAL_AUDIENCES, otherwise no token can ever pass. |
| config.SEED_PLATFORM_OPERATOR_EMAILS | string | `""` | Comma-separated emails the development seed makes owners of the demo tenant `acme-corp` with the platform-operator flag, so those accounts sign in to a PR environment as owner and platform admin rather than readonly. Read whenever the development seed runs; additive (dropping an email demotes nobody). pr-deploy.yml sets it from the PR_ENV_OPERATOR_EMAILS variable. |
| connectorEncryption.create | bool | `false` | Create a chart-managed Secret from the values below |
| connectorEncryption.currentVersion | int | `1` |  |
| connectorEncryption.existingSecret | string | `""` | Name of an existing Secret to use for connector encryption keys (takes precedence over chart-managed creation). When set, the secret volume will be mounted even if `create` is false. |
| connectorEncryption.keys.1 | string | `"< key placeholder >"` |  |
| connectorEncryption.mountPath | string | `"/etc/connector"` | Mounted path inside the container |
| connectorEncryption.retainOnUninstall | bool | `true` | Keep the chart-managed Secret when the release is uninstalled |
| extraEnv | list | `[]` | Extra plain environment variables appended to every container (name/value list) |
| extraEnvFrom | list | `[]` | Extra envFrom sources (configMapRef/secretRef) for every container |
| frontend.affinity | object | `{}` | Affinity for frontend pods |
| frontend.autoscaling.enabled | bool | `false` | Enable autoscaling for the frontend Deployment |
| frontend.autoscaling.maxReplicas | int | `3` | Maximum frontend replicas |
| frontend.autoscaling.minReplicas | int | `1` | Minimum frontend replicas |
| frontend.autoscaling.targetCPUUtilizationPercentage | int | `80` | Target average CPU utilization (percentage) |
| frontend.config.oidcClientId | string | `"dtsc-ui"` | client_id the SPA presents to the OIDC provider. Each environment registers a public (PKCE) client under this id on the provider side; the development seed registers `dtsc-ui`. |
| frontend.config.oidcScopes | string | `"openid profile email tenant offline_access"` | Scopes the SPA requests at sign-in. Keep to the set every role holds: the provider rejects, rather than trims, a request for scopes the user's role lacks, and `readonly` carries no API scopes at all. |
| frontend.enabled | bool | `true` | Deploy the UI frontend |
| frontend.image.pullPolicy | string | `"IfNotPresent"` | Frontend image pull policy |
| frontend.image.registry | string | `"ghcr.io"` | Frontend image registry |
| frontend.image.repository | string | `"bcgov/digital-trust-common-service-ui"` | Frontend image repository |
| frontend.image.tag | string | `""` | Frontend image tag (falls back to `image.tag`, then chart appVersion) |
| frontend.livenessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/","port":"http"},"initialDelaySeconds":10,"periodSeconds":15,"timeoutSeconds":3}` | Liveness probe for the frontend container |
| frontend.nodeSelector | object | `{}` | Node selector for frontend pods |
| frontend.podAnnotations | object | `{}` | Annotations added to frontend pods |
| frontend.podLabels | object | `{}` | Labels added to frontend pods |
| frontend.proxyPaths | list | `["/api/*","/oidc/*","/health/*"]` | URL paths reverse-proxied from the frontend to the API service |
| frontend.readinessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/","port":"http"},"initialDelaySeconds":5,"periodSeconds":10,"timeoutSeconds":3}` | Readiness probe for the frontend container |
| frontend.replicaCount | int | `1` | Frontend replicas (ignored when `frontend.autoscaling.enabled=true`) |
| frontend.resources | object | `{"limits":{"cpu":"250m","memory":"256Mi"},"requests":{"cpu":"25m","memory":"64Mi"}}` | Resource requests and limits for the frontend container |
| frontend.service.port | int | `8080` | Frontend Service port exposed to the cluster |
| frontend.service.targetPort | int | `8080` | Frontend container port (Caddy listener) |
| frontend.service.type | string | `"ClusterIP"` | Frontend Service type |
| frontend.tolerations | list | `[]` | Tolerations for frontend pods |
| frontend.trustedProxies | list | `["private_ranges"]` | Peers whose `X-Forwarded-*` headers Caddy trusts. An empty list omits the block entirely. |
| fullnameOverride | string | `""` | Override the fully qualified release name |
| grafana.affinity | object | `{}` | Affinity for Grafana pods |
| grafana.enabled | bool | `false` | Deploy the tenant Grafana. Needs `logGateway.enabled`, `config.APP_PUBLIC_URL`, `config.LOG_GATEWAY_AUDIENCE` and `route.host`. |
| grafana.image.pullPolicy | string | `"IfNotPresent"` | Grafana image pull policy |
| grafana.image.registry | string | `"docker.io"` | Grafana image registry |
| grafana.image.repository | string | `"grafana/grafana"` | Grafana image repository |
| grafana.image.tag | string | `"13.3.1"` | Grafana image tag |
| grafana.livenessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":30,"periodSeconds":15,"timeoutSeconds":3}` | Liveness probe for the Grafana container |
| grafana.nodeSelector | object | `{}` | Node selector for Grafana pods |
| grafana.oidc.clientId | string | `"dtsc-grafana"` | client_id Grafana presents to the OIDC provider. Register a public (PKCE) client under this id with redirect URI `https://<grafana.route.host>/login/generic_oauth`. |
| grafana.podAnnotations | object | `{}` | Annotations added to Grafana pods |
| grafana.podLabels | object | `{}` | Labels added to Grafana pods |
| grafana.readinessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":10,"periodSeconds":10,"timeoutSeconds":3}` | Readiness probe for the Grafana container |
| grafana.resources | object | `{"limits":{"cpu":"500m","memory":"256Mi"},"requests":{"cpu":"50m","memory":"128Mi"}}` | Resource requests and limits for the Grafana container |
| grafana.route.annotations | object | `{}` | Additional annotations for the Route |
| grafana.route.enabled | bool | `true` | Expose Grafana through an OpenShift Route (always TLS, HTTP redirected) |
| grafana.route.host | string | `""` | Tenant Grafana hostname; becomes Grafana's `root_url`. Required. |
| grafana.service.port | int | `3000` | Grafana Service port exposed to the cluster |
| grafana.service.targetPort | int | `3000` | Grafana container port |
| grafana.service.type | string | `"ClusterIP"` | Grafana Service type |
| grafana.tolerations | list | `[]` | Tolerations for Grafana pods |
| image.pullPolicy | string | `"IfNotPresent"` | Image pull policy |
| image.registry | string | `"ghcr.io"` | Container image registry (optional; omitted from the ref when empty) |
| image.repository | string | `"bcgov/digital-trust-common-service"` | Container image repository. API, Worker and migrations share this image. |
| image.tag | string | `""` | Image tag (defaults to the chart appVersion when empty) |
| imagePullSecrets | list | `[]` | Names of pre-created image pull secrets, e.g. `[{ name: my-registry }]` |
| ingress.annotations | object | `{}` | Ingress annotations |
| ingress.className | string | `""` | Ingress class name |
| ingress.enabled | bool | `false` | Expose the service via a Kubernetes Ingress |
| ingress.hosts | list | `[{"host":"chart-example.local","paths":[{"path":"/","pathType":"Prefix"}]}]` | Ingress hosts and paths |
| ingress.tls | list | `[]` | Ingress TLS configuration |
| livenessProbe.failureThreshold | int | `3` |  |
| livenessProbe.httpGet.path | string | `"/health/live"` |  |
| livenessProbe.httpGet.port | string | `"http"` |  |
| livenessProbe.initialDelaySeconds | int | `15` |  |
| livenessProbe.periodSeconds | int | `15` |  |
| livenessProbe.timeoutSeconds | int | `3` |  |
| logAccess.enabled | bool | `false` | Serve the internal log-access listener. Needs `gatewayPodSelector` and `networkPolicy.enabled`. |
| logAccess.gatewayPodSelector | object | `{}` | Labels of the log gateway pods, the only peers allowed to reach the internal port. Required when `enabled` is true, except that it defaults to the labels of the gateway deployed by `logGateway` when that is enabled. |
| logAccess.port | int | `8443` | Container and Service port of the internal TLS listener |
| logAccess.tls.mountPath | string | `"/var/run/secrets/log-access-tls"` | Where the serving-cert Secret (tls.crt, tls.key) is mounted. The certificate is read once at start, so a pod restart picks up a rotation. |
| logGateway.affinity | object | `{}` | Affinity for log gateway pods |
| logGateway.autoscaling.enabled | bool | `false` | Enable autoscaling for the log gateway Deployment |
| logGateway.autoscaling.maxReplicas | int | `3` | Maximum log gateway replicas |
| logGateway.autoscaling.minReplicas | int | `1` | Minimum log gateway replicas |
| logGateway.autoscaling.targetCPUUtilizationPercentage | int | `80` | Target average CPU utilization (percentage) |
| logGateway.enabled | bool | `false` | Deploy the log gateway. Needs `logAccess.enabled`, `networkPolicy.enabled`, `upstream.host` and `upstream.auth.existingSecret.name`. |
| logGateway.extAuthz.timeout | string | `"2s"` | How long Envoy waits for the decision endpoint before denying |
| logGateway.image.pullPolicy | string | `"IfNotPresent"` | Envoy image pull policy |
| logGateway.image.registry | string | `"docker.io"` | Envoy image registry |
| logGateway.image.repository | string | `"envoyproxy/envoy"` | Envoy image repository |
| logGateway.image.tag | string | `"v1.40.2"` | Envoy image tag. CI validates the rendered config with this exact tag, so bumping it here bumps the validator too. |
| logGateway.livenessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/livez","port":"probe"},"initialDelaySeconds":5,"periodSeconds":15,"timeoutSeconds":3}` | Liveness probe for the log gateway container |
| logGateway.metrics.podMonitor.enabled | bool | `false` | Create a Prometheus Operator PodMonitor (needs the monitoring.coreos.com CRDs) |
| logGateway.metrics.podMonitor.interval | string | `"30s"` | Scrape interval |
| logGateway.metrics.podMonitor.labels | object | `{}` | Extra labels, for a Prometheus that selects monitors by label |
| logGateway.metrics.podMonitor.scrapeTimeout | string | `"10s"` | Scrape timeout |
| logGateway.metrics.port | int | `9102` | Container port that serves only `/stats/prometheus`. It is on neither the Service nor the Route. |
| logGateway.metrics.prometheusRule.alertLabels | object | `{}` | Extra labels added to every alert, for example `team` or routing keys |
| logGateway.metrics.prometheusRule.certExpiryDays | int | `7` | Days of serving certificate validity left before alerting |
| logGateway.metrics.prometheusRule.checkErrorRatio | float | `0.02` | Fraction of requests the decision endpoint may fail to answer over 10m before alerting |
| logGateway.metrics.prometheusRule.denyRatio | float | `0.5` | Fraction of requests the gateway may deny over 15m before alerting |
| logGateway.metrics.prometheusRule.enabled | bool | `false` | Create a PrometheusRule with the gateway alerts (needs the monitoring.coreos.com CRDs) |
| logGateway.metrics.prometheusRule.errorRatio | float | `0.05` | Fraction of responses that may be 5xx over 10m before alerting |
| logGateway.metrics.prometheusRule.labels | object | `{}` | Extra labels, for a Prometheus that selects rules by label |
| logGateway.metrics.prometheusRule.latencyP99Ms | int | `5000` | p99 request latency in milliseconds over 10m before alerting |
| logGateway.nodeSelector | object | `{}` | Node selector for log gateway pods |
| logGateway.podAnnotations | object | `{}` | Annotations added to log gateway pods |
| logGateway.podLabels | object | `{}` | Labels added to log gateway pods |
| logGateway.probePort | int | `8081` | Container port of the probe listener. It answers only the kubelet probes and is on neither the Service nor the Route. |
| logGateway.readinessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/ready","port":"probe"},"initialDelaySeconds":3,"periodSeconds":10,"timeoutSeconds":3}` | Readiness probe for the log gateway container |
| logGateway.replicaCount | int | `1` | Log gateway replicas (ignored when `logGateway.autoscaling.enabled=true`) |
| logGateway.resources | object | `{"limits":{"cpu":"250m","memory":"128Mi"},"requests":{"cpu":"50m","memory":"64Mi"}}` | Resource requests and limits for the log gateway container |
| logGateway.route.annotations | object | `{"haproxy.router.openshift.io/timeout":"70s"}` | Additional annotations for the Route. The router's default timeout is 30s, which would cut off long queries; keep the timeout here above `upstream.timeout`. |
| logGateway.route.enabled | bool | `false` | Expose the gateway through an OpenShift Route (always re-encrypted) |
| logGateway.route.host | string | `""` | Route hostname (OpenShift generates one when empty) |
| logGateway.service.port | int | `8443` | Log gateway Service port exposed to the cluster |
| logGateway.service.targetPort | int | `8443` | Log gateway container port (Envoy TLS listener) |
| logGateway.service.type | string | `"ClusterIP"` | Log gateway Service type |
| logGateway.tls.mountPath | string | `"/var/run/secrets/log-gateway-tls"` | Where the serving-cert Secret (tls.crt, tls.key) is mounted. The certificate is read once at start, so a pod restart picks up a rotation. |
| logGateway.tolerations | list | `[]` | Tolerations for log gateway pods |
| logGateway.upstream.auth.existingSecret | object | `{"key":"authorization","name":""}` | Existing Secret holding the complete `Authorization` header value for the Loki gateway (for example `Basic <base64 of user:password>`). The chart never creates it. It is read at start, so a change needs a pod restart. |
| logGateway.upstream.host | string | `""` | Host of the Loki gateway Service. Required when `enabled` is true. |
| logGateway.upstream.port | int | `80` | Service port of the Loki gateway. Envoy connects over plain HTTP: the Service offers no TLS, and the caller's bearer token never reaches it. |
| logGateway.upstream.timeout | string | `"65s"` | How long Envoy waits for Loki to answer a query. Keep it above Loki's `query_timeout` (60s), or Envoy cuts off queries Loki would have answered. |
| migrations.activeDeadlineSeconds | int | `300` | Maximum seconds the migration Job may run before Kubernetes marks it failed. Prevents hung migrations (e.g. waiting on a lock) from blocking a release indefinitely. |
| migrations.argocd | object | `{"enabled":false}` | Emit an ArgoCD PreSync hook annotation so migrations also run under GitOps (ArgoCD does not execute Helm hooks natively) |
| migrations.args | list | `["node_modules/typeorm/cli.js","migration:run","-d","dist/libs/database/src/data-source.js"]` | Migration entrypoint args: the TypeORM CLI against the compiled DataSource — what `npm run migrate:up` runs, invoked directly so the Job needs neither npm nor a writable home directory. |
| migrations.backoffLimit | int | `2` | Number of retries before the migration Job is marked failed (2 retries = 3 total attempts) |
| migrations.command | list | `["node"]` | Migration entrypoint command |
| migrations.enabled | bool | `false` | Run database migrations as a pre-install/pre-upgrade Helm hook Job. Runs exactly once per release before the app pods roll, avoiding the concurrent/every-boot execution that an init container would cause across replicas and HPA scale-ups. A hook runs before the release's own resources exist, so the Job carries the non-secret `config.*` inline, runs under the namespace default ServiceAccount unless `serviceAccount.create` is false, and requires `secret.existingSecret` (a chart-managed Secret would not exist yet on a first install, so that combination is refused at render time). |
| migrations.hook | object | `{"deletePolicy":"before-hook-creation,hook-succeeded","types":"pre-install,pre-upgrade","weight":"-5"}` | Helm hook configuration for the migration Job. `pre-install,pre-upgrade` is fail-closed: a failed migration aborts the release and the old version keeps serving. NOTE: the migration runner should still wrap its run in a Postgres advisory lock (pg_advisory_lock/unlock) as defence in depth, since TypeORM does not lock migrations by default. |
| migrations.hook.deletePolicy | string | `"before-hook-creation,hook-succeeded"` | Hook resource delete policy |
| migrations.hook.types | string | `"pre-install,pre-upgrade"` | Helm hook types that trigger the migration Job |
| migrations.hook.weight | string | `"-5"` | Hook execution order (lower weights run earlier) |
| migrations.resources | object | `{"limits":{"cpu":"250m","memory":"256Mi"},"requests":{"cpu":"25m","memory":"128Mi"}}` | Resource requests/limits for the migration Job |
| migrations.waitForDB | object | `{"enabled":false,"image":"busybox","tag":"1.36","timeoutSeconds":60}` | Optional init container that blocks the migration until the database (DB_HOST:DB_PORT from the app config) is reachable |
| migrations.waitForDB.timeoutSeconds | int | `60` | Maximum seconds to wait for the database before failing with a clear error |
| nameOverride | string | `""` | Override the chart name |
| networkPolicy.collector.enabled | bool | `false` | Allow API/Worker egress to the OTLP collector. Implied by `otel.enabled`: the database and Keycloak rules already isolate the pods' egress, so without this rule the SDK's exporter is blocked and telemetry is dropped with no error. Rendered whenever either this or `otel.enabled` is true, the same way `dnsEgress` is derived from the other egress rules. |
| networkPolicy.collector.namespaceSelector | object | `{}` | Namespace selector matching the collector's namespace |
| networkPolicy.collector.podSelector | object | `{}` | Pod selector matching the collector pods. When both podSelector and namespaceSelector are empty, egress is allowed to any destination on the collector port, the same as the database and Keycloak rules. Set these in per-env values. |
| networkPolicy.collector.port | int | `4318` | Collector port, matching `otel.protocol`'s default (http/protobuf on 4318) |
| networkPolicy.database.enabled | bool | `true` | Allow API/Worker egress to PostgreSQL |
| networkPolicy.database.namespaceSelector | object | `{}` | Namespace selector matching the database namespace |
| networkPolicy.database.podSelector | object | `{}` | Pod selector matching the database pods. When both podSelector and namespaceSelector are empty, egress is allowed to any destination on the database port. Set these in per-env values. |
| networkPolicy.database.port | int | `5432` | Database port |
| networkPolicy.dnsEgress.enabled | bool | `true` | Allow DNS egress (required whenever any egress rule is enabled) |
| networkPolicy.dnsEgress.ports | list | `[53,5353]` | DNS ports to allow. Both are required on OpenShift: pods query the dns-default Service on 53, but CoreDNS actually listens on 5353, and OVN-Kubernetes evaluates egress policy AFTER the service DNAT rewrites the port — allowing only 53 silently drops every DNS packet. |
| networkPolicy.enabled | bool | `true` | Enable NetworkPolicies |
| networkPolicy.ingress.enabled | bool | `true` | Allow ingress from the OpenShift router to the externally exposed component (frontend when enabled, API otherwise) |
| networkPolicy.ingress.routerNamespaceSelector | object | `{"policy-group.network.openshift.io/ingress":""}` | Namespace selector matching the OpenShift router namespace |
| networkPolicy.keycloak.enabled | bool | `false` | Allow API egress to Keycloak (upstream IdP) |
| networkPolicy.keycloak.namespaceSelector | object | `{}` | Namespace selector matching the Keycloak namespace |
| networkPolicy.keycloak.podSelector | object | `{}` | Pod selector matching the Keycloak pods |
| networkPolicy.keycloak.port | int | `443` | Keycloak port |
| networkPolicy.logGateway.ingressPeers | list | `[]` | Extra peers (NetworkPolicy `from` entries) allowed to call the log gateway besides the OpenShift router, for example an in-cluster Grafana. |
| networkPolicy.loki.namespaceSelector | object | `{}` | Namespace selector matching the Loki namespace |
| networkPolicy.loki.podSelector | object | `{}` | Pod selector matching the Loki gateway pods. When both podSelector and namespaceSelector are empty, egress is allowed to any destination on that port. Set these in per-env values. |
| networkPolicy.loki.port | int | `8080` | Loki gateway pod port the log gateway may reach. Egress policy is evaluated after the Service port is rewritten (see `dnsEgress`), so this is the pod's port, not the Service port. |
| networkPolicy.monitoring.namespaceSelector | object | `{"network.openshift.io/policy-group":"monitoring"}` | Namespace selector matching the Prometheus that scrapes the log gateway. Used only when `logGateway.metrics.podMonitor.enabled`. |
| networkPolicy.monitoring.podSelector | object | `{"app.kubernetes.io/name":"alloy"}` | Pod selector matching the in-namespace collector that scrapes the `PodMonitor`. It runs inside the app's namespace, so the namespace selector alone does not admit it. |
| nodeSelector | object | `{}` | Node selector for API pods |
| oidcSigning.cookieKeys | string | `""` | Comma-separated cookie signing secrets (OIDC_COOKIE_KEYS). Generated once and preserved across upgrades when empty. Preservation needs an in-cluster `helm upgrade`; a client-side render (template/diff/GitOps) would rotate them and drop active sessions, so pin them if you use one. |
| oidcSigning.create | bool | `false` | Create a chart-managed Secret from the values below |
| oidcSigning.existingSecret | string | `""` | Name of an existing Secret holding the signing JWKS |
| oidcSigning.keys | string | `""` | RS256 JWKS document. Helm cannot generate one, so it is supplied by the caller: `node scripts/generate-oidc-keys.mjs oidc-keys.json` then `--set-file oidcSigning.keys=oidc-keys.json`. Left empty on upgrade, the keys already in the live Secret are kept. |
| oidcSigning.mountPath | string | `"/etc/oidc"` | Mounted path inside the container |
| oidcSigning.retainOnUninstall | bool | `true` | Keep the chart-managed Secret when the release is uninstalled |
| otel.apiServiceName | string | `"digital-trust-common-service"` | OTEL_SERVICE_NAME reported by the API, so it is separable from the Worker in Grafana. |
| otel.enabled | bool | `false` | Enable OTel export for the API and Worker. Rendering fails if this is true and `endpoint` is empty, rather than letting the SDK fall back to `localhost:4318` and silently drop telemetry. |
| otel.endpoint | string | `""` | OTLP collector endpoint (e.g. `http://monitoring-collector-alloy:4318` once deployed). Left empty here — the chart names no organisation's collector; an overlay must supply this when `enabled` is true. |
| otel.logsExporter | string | `"none"` | OTEL_LOGS_EXPORTER for both the API and Worker. `none` on purpose, and it must be set explicitly: deployed, logs go to stdout and Alloy ships them to Loki, but leaving this unset does not mean "off" — the SDK's own default is `otlp`, so it builds a logger provider and the pino instrumentation posts every log line to the collector's `/v1/logs` as well. That is the same lines twice, over the wire and through Alloy, for no added signal. Trace correlation is unaffected: `trace_id` and `span_id` come from the instrumentation's pino mixin, not from log sending. |
| otel.metricsExporter | string | `"otlp"` | OTEL_METRICS_EXPORTER for both the API and Worker. |
| otel.protocol | string | `"http/protobuf"` | OTLP protocol. `http/protobuf` on 4318 matches the platform's Alloy collector; a gRPC exporter needs both this and `networkPolicy.collector.port` changed to match. |
| otel.tracesExporter | string | `"otlp"` | OTEL_TRACES_EXPORTER for both the API and Worker. |
| otel.workerServiceName | string | `"digital-trust-common-service-worker"` | OTEL_SERVICE_NAME reported by the Worker, so it is separable from the API in Grafana. |
| podAnnotations | object | `{}` | Annotations added to the API/Worker pods |
| podLabels | object | `{}` | Labels added to the API/Worker pods |
| podSecurityContext | object | `{}` | Pod security context. On BC Gov OpenShift the restricted-v2 SCC assigns UID/fsGroup/SELinux automatically; leave empty unless you must pin values. |
| readinessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/health/ready","port":"http"},"initialDelaySeconds":10,"periodSeconds":10,"timeoutSeconds":3}` | Readiness probe. `/health/ready` reports whether this pod should receive traffic: it fails during graceful shutdown and when the database is unreachable, and deliberately ignores pg-boss, the OIDC provider and Traction. |
| replicaCount | int | `1` | Number of API pod replicas (ignored when `autoscaling.enabled=true`) |
| resources | object | `{"limits":{"cpu":"250m","memory":"256Mi"},"requests":{"cpu":"50m","memory":"128Mi"}}` | Resource requests and limits for the API container |
| route.annotations | object | `{}` | Additional annotations for the Route |
| route.enabled | bool | `true` | Expose the service via an OpenShift Route |
| route.host | string | `""` | Route hostname (OpenShift generates one when empty) |
| route.path | string | `""` | Optional explicit route path |
| route.tls.enabled | bool | `true` | Enable TLS on the Route |
| route.tls.insecureEdgeTerminationPolicy | string | `"Redirect"` | Policy for insecure (HTTP) traffic |
| route.tls.termination | string | `"edge"` | TLS termination type |
| secret.create | bool | `false` | Create a chart-managed Secret from the values below |
| secret.data | object | `{"DB_PASSWORD":"","DB_USERNAME":""}` | Non-generated key/values placed into the chart-managed Secret |
| secret.existingSecret | string | `""` | Name of an existing Secret to consume for env vars |
| secret.retainOnUninstall | bool | `true` | Keep the chart-managed Secret when the release is uninstalled |
| securityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":false,"runAsNonRoot":true}` | Container security context applied to all containers |
| service.port | int | `8080` | Service port exposed to the cluster |
| service.targetPort | int | `3000` | Container port the NestJS app binds to (the `PORT` env) |
| service.type | string | `"ClusterIP"` | Service type |
| serviceAccount.annotations | object | `{}` | Annotations for the service account |
| serviceAccount.automount | bool | `false` | Automatically mount the service account's API credentials. Off by default: nothing in the API, Worker or UI talks to the Kubernetes API. |
| serviceAccount.create | bool | `true` | Create a service account |
| serviceAccount.name | string | `""` | Service account name (generated from the fullname when empty and `create` is true) |
| startupProbe | object | `{"failureThreshold":30,"httpGet":{"path":"/health/live","port":"http"},"periodSeconds":5,"timeoutSeconds":3}` | Startup probe. Gates the liveness and readiness probes until the app is up, so a slow boot (Nest module init, DB connect) can't be killed by liveness. `failureThreshold` x `periodSeconds` is the boot budget — 30 x 5s = 150s. |
| tolerations | list | `[]` | Tolerations for API pods |
| upstreamFederation.existingSecret | object | `{"key":"upstream-identity-federation.json","name":""}` | Existing Secret reference for upstream federation config JSON. The chart never creates this Secret; it must be provisioned manually. |
| upstreamFederation.fileName | string | `"upstream-identity-federation.json"` | Filename for the upstream federation config JSON. |
| upstreamFederation.mountPath | string | `"/etc/upstream-identity-federation"` | Mounted directory that contains the upstream federation config file. |
| volumeMounts | list | `[]` | Extra volume mounts for the API/Worker containers. The connector encryption and OIDC signing mounts are added by the chart alongside their Secrets and do not need to be listed here. |
| volumes | list | `[]` | Extra volumes for the API/Worker pods |
| worker.affinity | object | `{}` | Affinity for Worker pods |
| worker.args | list | `["dist/worker.js"]` | Worker entrypoint args |
| worker.autoscaling.enabled | bool | `false` | Enable autoscaling for the Worker Deployment |
| worker.autoscaling.maxReplicas | int | `5` | Maximum Worker replicas |
| worker.autoscaling.minReplicas | int | `1` | Minimum Worker replicas |
| worker.autoscaling.targetCPUUtilizationPercentage | int | `80` | Target average CPU utilization (percentage) |
| worker.command | list | `["node"]` | Worker entrypoint command |
| worker.enabled | bool | `false` | Deploy the Worker |
| worker.livenessProbe | object | `{}` | Liveness probe for the Worker (no HTTP server by default) |
| worker.nodeSelector | object | `{}` | Node selector for Worker pods |
| worker.podAnnotations | object | `{}` | Annotations added to Worker pods |
| worker.podLabels | object | `{}` | Labels added to Worker pods |
| worker.replicaCount | int | `1` | Worker replicas (ignored when `worker.autoscaling.enabled=true`) |
| worker.resources | object | `{"limits":{"cpu":"250m","memory":"256Mi"},"requests":{"cpu":"50m","memory":"128Mi"}}` | Resource requests/limits for the Worker container |
| worker.tolerations | list | `[]` | Tolerations for Worker pods |

