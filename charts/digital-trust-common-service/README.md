# vc-common-service

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.0.1](https://img.shields.io/badge/AppVersion-0.0.1-informational?style=flat-square)

A Helm chart to deploy the VC Common Service (NestJS) on BC Gov OpenShift

## Prerequisites

- Kubernetes 1.25+ / OpenShift 4.12+
- Helm 3.8.0+
- An external PostgreSQL database and (optionally) a Keycloak instance
- A pre-provisioned `Secret` with database credentials (or set `secret.create=true`)

## Installing the Chart

```console
helm install vc-common-service ./charts/vc-common-service \
  -n <namespace> \
  -f charts/vc-common-service/values-dev.yaml
```

The [Values](#values) section lists all configurable parameters.

## Architecture

This chart deploys the VC Common Service (a NestJS modular monolith) to BC Gov
OpenShift. Key characteristics:

- **API Deployment** — HTTP service on container port `3000`; liveness and
  readiness probes on `/health/live`.
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
| config | object | `{"DB_HOST":"","DB_LOGGING":"false","DB_NAME":"vc_common_service","DB_PORT":"5432","DB_SYNCHRONIZE":"false","LOG_LEVEL":"info","NODE_ENV":"production","PORT":"3000","SWAGGER_ENABLED":"true","SWAGGER_JSON_ENABLED":"true"}` | Non-secret application configuration, rendered into a ConfigMap and injected as environment variables into all containers. |
| extraEnv | list | `[]` | Extra plain environment variables appended to every container (name/value list) |
| extraEnvFrom | list | `[]` | Extra envFrom sources (configMapRef/secretRef) for every container |
| fullnameOverride | string | `""` | Override the fully qualified release name |
| image.pullPolicy | string | `"IfNotPresent"` | Image pull policy |
| image.registry | string | `"ghcr.io"` | Container image registry (optional; omitted from the ref when empty) |
| image.repository | string | `"bcgov/vc-common-service"` | Container image repository. API, Worker and migrations share this image. |
| image.tag | string | `""` | Image tag (defaults to the chart appVersion when empty) |
| imagePullSecrets | list | `[]` | Names of pre-created image pull secrets, e.g. `[{ name: my-registry }]` |
| ingress.annotations | object | `{}` | Ingress annotations |
| ingress.className | string | `""` | Ingress class name |
| ingress.enabled | bool | `false` | Expose the service via a Kubernetes Ingress |
| ingress.hosts | list | `[{"host":"chart-example.local","paths":[{"path":"/","pathType":"Prefix"}]}]` | Ingress hosts and paths |
| ingress.tls | list | `[]` | Ingress TLS configuration |
| livenessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/health/live","port":"http"},"initialDelaySeconds":15,"periodSeconds":15,"timeoutSeconds":3}` | Liveness probe. IN-01 provides a minimal 200 at `/health/live`. |
| migrations.activeDeadlineSeconds | int | `300` | Maximum seconds the migration Job may run before Kubernetes marks it failed. Prevents hung migrations (e.g. waiting on a lock) from blocking a release indefinitely. |
| migrations.argocd | object | `{"enabled":false}` | Emit an ArgoCD PreSync hook annotation so migrations also run under GitOps (ArgoCD does not execute Helm hooks natively) |
| migrations.args | list | `["dist/apps/vc-common-service/src/migrate.js"]` | Migration entrypoint args |
| migrations.backoffLimit | int | `2` | Number of retries before the migration Job is marked failed (2 retries = 3 total attempts) |
| migrations.command | list | `["node"]` | Migration entrypoint command |
| migrations.enabled | bool | `false` | Run database migrations as a pre-install/pre-upgrade Helm hook Job. Runs exactly once per release before the app pods roll, avoiding the concurrent/every-boot execution that an init container would cause across replicas and HPA scale-ups. |
| migrations.hook | object | `{"deletePolicy":"before-hook-creation,hook-succeeded","types":"pre-install,pre-upgrade","weight":"-5"}` | Helm hook configuration for the migration Job. `pre-install,pre-upgrade` is fail-closed: a failed migration aborts the release and the old version keeps serving. NOTE: the migration runner (migrate.js) should still wrap its run in a Postgres advisory lock (pg_advisory_lock/unlock) as defence in depth, since TypeORM does not lock migrations by default. |
| migrations.hook.deletePolicy | string | `"before-hook-creation,hook-succeeded"` | Hook resource delete policy |
| migrations.hook.types | string | `"pre-install,pre-upgrade"` | Helm hook types that trigger the migration Job |
| migrations.hook.weight | string | `"-5"` | Hook execution order (lower weights run earlier) |
| migrations.resources | object | `{"limits":{"cpu":"250m","memory":"256Mi"},"requests":{"cpu":"25m","memory":"128Mi"}}` | Resource requests/limits for the migration Job |
| migrations.waitForDB | object | `{"enabled":false,"image":"busybox","tag":"1.36","timeoutSeconds":60}` | Optional init container that blocks the migration until the database (DB_HOST:DB_PORT from the app config) is reachable |
| migrations.waitForDB.timeoutSeconds | int | `60` | Maximum seconds to wait for the database before failing with a clear error |
| nameOverride | string | `""` | Override the chart name |
| networkPolicy.database.enabled | bool | `true` | Allow API/Worker egress to PostgreSQL |
| networkPolicy.database.namespaceSelector | object | `{}` | Namespace selector matching the database namespace |
| networkPolicy.database.podSelector | object | `{}` | Pod selector matching the database pods. When both podSelector and namespaceSelector are empty, egress is allowed to any destination on the database port. Set these in per-env values. |
| networkPolicy.database.port | int | `5432` | Database port |
| networkPolicy.dnsEgress.enabled | bool | `true` | Allow DNS egress (required whenever any egress rule is enabled) |
| networkPolicy.dnsEgress.ports | list | `[53,5353]` | DNS ports to allow. Both are required on OpenShift: pods query the dns-default Service on 53, but CoreDNS actually listens on 5353, and OVN-Kubernetes evaluates egress policy AFTER the service DNAT rewrites the port — allowing only 53 silently drops every DNS packet. |
| networkPolicy.enabled | bool | `true` | Enable NetworkPolicies |
| networkPolicy.ingress.enabled | bool | `true` | Allow ingress to the API from the OpenShift router |
| networkPolicy.ingress.routerNamespaceSelector | object | `{"policy-group.network.openshift.io/ingress":""}` | Namespace selector matching the OpenShift router namespace |
| networkPolicy.keycloak.enabled | bool | `false` | Allow API egress to Keycloak (upstream IdP) |
| networkPolicy.keycloak.namespaceSelector | object | `{}` | Namespace selector matching the Keycloak namespace |
| networkPolicy.keycloak.podSelector | object | `{}` | Pod selector matching the Keycloak pods |
| networkPolicy.keycloak.port | int | `443` | Keycloak port |
| nodeSelector | object | `{}` | Node selector for API pods |
| podAnnotations | object | `{}` | Annotations added to the API/Worker pods |
| podLabels | object | `{}` | Labels added to the API/Worker pods |
| podSecurityContext | object | `{}` | Pod security context. On BC Gov OpenShift the restricted-v2 SCC assigns UID/fsGroup/SELinux automatically; leave empty unless you must pin values. |
| readinessProbe | object | `{"failureThreshold":3,"httpGet":{"path":"/health/live","port":"http"},"initialDelaySeconds":10,"periodSeconds":10,"timeoutSeconds":3}` | Readiness probe. Uses `/health/live` until a dedicated readiness endpoint is added. |
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
| serviceAccount.automount | bool | `true` | Automatically mount the service account's API credentials |
| serviceAccount.create | bool | `true` | Create a service account |
| serviceAccount.name | string | `""` | Service account name (generated from the fullname when empty and `create` is true) |
| tolerations | list | `[]` | Tolerations for API pods |
| volumeMounts | list | `[]` | Extra volume mounts for the API/Worker containers |
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

