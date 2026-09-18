# Baseline OpenTelemetry Metrics

This is the cardinality contract for the metrics digital-trust-common-service
exports today. It exists so a later ticket that wants to add a metric, or a
label to an existing one, has a number and a rule to be judged against instead
of a feeling.

Figures here are verified against both the local `otel-lgtm` stack and the
deployed Alloy/Mimir path in `4a9599-dev`. The two label metrics differently,
so a query valid in one returns nothing in the other — see
[Resource attributes differ between local and deployed](#resource-attributes-differ-between-local-and-deployed)
before writing one.

**No instruments are defined in application code.** Every metric below comes
from OpenTelemetry auto-instrumentation (`@opentelemetry/auto-instrumentations-node`,
which bundles `instrumentation-http`, `instrumentation-pg`, and
`instrumentation-runtime-node`) wired up in
[tracing.ts](../libs/common/src/telemetry/tracing.ts). There is no `getMeter`,
counter, or histogram anywhere in the codebase. Business metrics (credential
operations, queue depth) are later, separate tickets and must cite the rule
below rather than re-litigate it — see [Business metrics](#business-metrics)
for what is planned and what it is expected to cost.

**Metrics are operator-facing only.** The tenant-facing Grafana instance
(see [tenant-observability-design.md](./tenant-observability-design.md)) is
logs-only — none of the metrics below are exposed to tenants, and none of
them could identify one even if they were, per the labelling rule.

## Labelling rule

1. **Tenant identity never becomes a metric label.** Tenant count is
   unbounded, and every label multiplies series count. Tenant identity lives
   on spans and logs (`tenant.id`), where it is already available for
   correlation. Any later ticket proposing a `tenant_id` (or similarly
   per-tenant) label on a metric must fail review against this rule instead
   of re-deciding it.
2. **Low-cardinality dimensions only**: operation type, outcome/status,
   adapter, protocol, route template, classified error code — never a raw
   identifier (operation id, connection id, credential id, user id).

## Business metrics

Everything in the catalog below measures plumbing: how many HTTP requests
arrived, how long database statements took, how busy the runtime is. All of
it can look completely healthy while the service is failing at its job —
every request returning `200 OK` while not a single credential has been
issued for hours, because the agent is rejecting them further down.

Nothing counts the work itself. That is what business metrics are for, and
none exist yet.

### They are one step of four

A counter on its own does not tell you very much. It is useful because it
starts a path that ends somewhere actionable:

| Step | Signal | Answers |
| --- | --- | --- |
| 1. Notice | a business counter, plus an alert | "issuance failures are up" |
| 2. Attribute | logs | "it is concentrated in one tenant" |
| 3. Diagnose | a trace from that tenant | "here is exactly what failed" |
| 4. Act | — | fix it, or contact the tenant |

Step 1 is the part that does not exist. Without it nothing ever prompts
anyone to start at step 2, and a tenant can fail every operation for days
unnoticed.

This is also the reason rule 1 above exists. "Which tenant?" is answered at
step 2, from logs, at the moment someone investigates — not by storing a
separate copy of every counter for every tenant, forever, on the chance that
somebody asks. Step 3 already works: `TenantSpanInterceptor` puts `tenant.id`
on every span.

> **Step 2's mechanism is not settled, and is not deployed.** Today Loki runs
> `auth_enabled: false` — everything lands under the single `fake` tenant —
> and Alloy runs `static_labels` + `label_keep` only. The per-tenant routing
> described below is the *target* design, not current behaviour.
>
> Under that target, Alloy would route each log line to its own Loki tenant
> (`stage.tenant`, with `auth_enabled: true`), so tenant logs would be held in
> separate partitions rather than distinguished by a label within one stream.
> Aggregating across tenants to see where something is concentrated would then
> need a multi-tenant query scope, and it has not been confirmed which
> operator-facing scope provides that, or whether `tenant_id` survives routing
> as a queryable field. Resolve both the rollout and that question before
> relying on step 2 — see
> [tenant-observability-design.md](./tenant-observability-design.md).

### Candidates

None of these are committed. Each needs an operator question attached — some
sentence a person would ask, where a different answer leads to a different
action — and a candidate nobody has a question for should not ship.

Dimension values are taken from sets that already exist in the codebase, so
none of them can grow with traffic or tenant count:

| Candidate | Dimensions | Series |
| --- | --- | --- |
| credential operation outcome | operation type (8 declared) x outcome (2) | 16 |
| adapter call outcome | adapter (2) x port method (12) x outcome or error class (6) | 144 |
| job queue depth | queue (9 registered) | 9 |

That is **about 169 series at worst**, against the roughly 3,000 estimated
below — near enough 5%. The sets behind each number are `OPERATION_TYPE`,
`OperationState`, `ConnectorType`, `QUEUE_DEFINITIONS`, the five port
interfaces in `libs/credential-ports/src/ports/`, and the five adapter error
classes in `libs/credential-ports/src/errors/`. Re-count them before
building, since three of the six are still growing.

### What exists to measure, and what does not

Four of the eight declared operation types are constructed in code today:
`credential.offer`, `credential.accept`, `credential.reject`, and
`credential.revoke`. The other four — `credential.offer-batch`,
`credential.revoke-batch`, `presentation.request`, and `connection.create` —
are declared but never created, and `operation-type.constants.ts` notes that
they arrive in later slices.

Note this describes operations, not features: `connection/` and
`verification-profile/` exist as modules. What is absent is any `Operation`
record of those types.

### Coverage rule

A counter instrumented against today's four operation types will silently
under-report once the other four land. That is worse than having no counter,
because the number still looks authoritative while being wrong, and nothing
about it appears broken.

So, alongside the labelling rules above:

**New values must be covered.** A change that adds a value to
`OPERATION_TYPE`, a port method, an adapter error class, or
`QUEUE_DEFINITIONS` must either extend the business metric dimensions to
match, or record in the PR why that value is deliberately excluded. Like the
labelling rules, this is enforced at review rather than re-decided per
ticket.

This is the rule most easily missed, because the change that breaks it is a
feature change with nothing obviously to do with metrics.

## Metric catalog

Instrument names are dotted, per OTel semantic conventions
(`http.server.request.duration`); the Prometheus exporter renders them
underscored with a unit suffix (`http_server_request_duration_seconds`).
Query the Prometheus form in Grafana; the dotted form is what you'll find in
the OTel/semconv source if you need to trace a metric back to the
instrumentation package that emits it.

| Prometheus name | OTel instrument | Type | Dimensions (bounded by) |
| --- | --- | --- | --- |
| `http_server_request_duration_seconds` | `http.server.request.duration` | Histogram (15 buckets) | `http_route` (declared controller routes, currently 58; absent — not a placeholder — when no route matches), `http_request_method`, `http_response_status_code`, `network_protocol_version`, `url_scheme` |
| `http_client_request_duration_seconds` | `http.client.request.duration` | Histogram (15 buckets) | `server_address`/`server_port` (outbound hosts we call: upstream OIDC issuer today, adapter backends once instrumented), `http_request_method`, `http_response_status_code`, `url_scheme` |
| `db_client_operation_duration_seconds` | `db.client.operation.duration` | Histogram (10 buckets) | `db_operation_name` (SQL verb — see finding below), `db_system_name`, `db_namespace`, `server_address`/`server_port` |
| `db_client_connection_count` | `db.client.connection.count` | Gauge | `db_client_connection_state` (`used`/`idle`), `db_client_connection_pool_name` (one pool) |
| `db_client_connection_pending_requests` | `db.client.connection.pending_requests` | Gauge | `db_client_connection_pool_name` (one pool) |
| `nodejs_eventloop_delay_{min,max,mean,stddev,p50,p90,p99}_seconds` | `nodejs.eventloop.delay.{min,max,mean,stddev,p50,p90,p99}` | Gauge | none — one series per process |
| `nodejs_eventloop_time_seconds_total` | `nodejs.eventloop.time` | Counter | `nodejs_eventloop_state` (`active`/`idle`) |
| `nodejs_eventloop_utilization_ratio` | `nodejs.eventloop.utilization` | Gauge | none |
| `v8js_gc_duration_seconds` | `v8js.gc.duration` | Histogram (15 buckets) | `v8js_gc_type` (`minor`/`major`/`incremental`) |
| `v8js_memory_heap_used_bytes` | `v8js.memory.heap.used` | Gauge | `v8js_heap_space_name` (11 fixed V8 heap spaces) |
| `v8js_memory_heap_space_size_bytes` | `v8js.memory.heap.space.size` | UpDownCounter | `v8js_heap_space_name` (11) |
| `v8js_memory_heap_space_available_size_bytes` | `v8js.memory.heap.space.available_size` | UpDownCounter | `v8js_heap_space_name` (11) |
| `v8js_memory_heap_space_physical_size_bytes` | `v8js.memory.heap.space.physical_size` | UpDownCounter | `v8js_heap_space_name` (11) |
| `v8js_resource_active` | `v8js.resource.active` | Gauge | `v8js_resource_type` (fixed set of libuv handle types, e.g. `TCPSocketWrap`, `Timeout`) |

### Resource attributes differ between local and deployed

**How the resource reaches Prometheus depends on which collector is in front
of it, and the two we run do it differently.** This changes what you can put
in a selector, so it is worth reading before writing a query.

Deployed, a series carries its identity in `job` and nothing else from the
resource:

```text
http_server_request_duration_seconds_count{
  job="digital-trust-common-service",
  http_route="/health/live", http_request_method="GET",
  http_response_status_code="200",
  network_protocol_version="1.1", url_scheme="http"
}
```

Alloy's `otelcol.exporter.prometheus` maps `service.name` onto `job` and puts
the entire rest of the resource — `deployment_environment_name`, `host_name`,
`host_arch`, `process_*`, `telemetry_sdk_*`, `service_version` — on a single
`target_info` series that you join in at query time. There is **no
`service_name` label deployed at all**.

Locally, the `grafana/otel-lgtm` image's embedded collector promotes resource
attributes onto every series instead, so `service_name`,
`deployment_environment_name` and `host_name` are all directly selectable
there.

Neither is a misconfiguration and we own neither behaviour. Do not "fix" the
deployed side by turning on resource-to-telemetry conversion in Alloy: that
copies *every* resource attribute onto *every* series, including
`process_command_args` and `process_executable_path`, which is exactly the
per-series label bloat the `target_info` split exists to avoid.

Practical consequences:

- **Filter on `job` deployed, `service_name` locally.** A query written
  against one returns nothing at all against the other — silently, since an
  empty result looks identical to "no traffic".
- `host_name` is on `target_info` deployed, so a rollout adds **one** new
  `target_info` series rather than churning every metric the process exports —
  three over a recent 24 hours here, one per pod generation. Locally it is a
  per-series label, so the same rollout churns all of them.
- Anything filtering on `deployment_environment_name` or `process_pid` needs a
  `target_info` join deployed. In practice environments are already separated
  by writing to different backends, so the join is rarely what you want.

## Series-count estimate

Per unique `(http_route, http_request_method, http_response_status_code)`
combination: 17 rows (15 histogram buckets + `_count` + `_sum`). With 58
declared route templates and realistically 2-4 status codes per route
(200/201, 400/401/403/404, occasional 5xx), the baseline HTTP-server budget
is on the order of **58 routes × ~3 statuses × 17 rows ≈ 3,000 series** at
full route coverage — most of that headroom, since a given deployment only
sees the routes and statuses actual traffic exercises. Verified locally
(light manual traffic): 6 distinct route/method/status combinations, giving
6 `_count` + 6 `_sum` + 90 bucket rows.

Per unique `db_operation_name`: 12 rows (10 buckets + count + sum). Bounded
by the statement verbs the codebase issues — verified locally as `SELECT`,
`INSERT`, `UPDATE`, `DELETE`, `CREATE`, `WITH` and `BEGIN`, so seven verbs
once the normalization below collapses the whitespace variants, or 84 rows.

Runtime metrics (`nodejs_*`, `v8js_*`) are fixed per process regardless of
traffic: 7 event-loop-delay gauges + 2 event-loop-time rows + 1 utilization +
51 GC rows (15 buckets × 3 GC types, plus a `_count` and a `_sum` each) + 44
heap rows (11 heap spaces × 4 heap metrics) + 4 `v8js_resource_active` rows =
**109 series**, present the moment the process starts, independent of any
request.

None of this is unbounded: the only user-influenced input is which of the 58
route templates and which statement verbs get exercised, both fixed sets
enumerable from the codebase — not from request content.

### Verified against the deployed backend

Measured in Mimir against `4a9599-dev`, with the dev pod exporting through
Alloy under light traffic:

| | series |
| --- | --- |
| total, one instance (`{job="digital-trust-common-service"}`) | 297 |
| runtime (`nodejs_*`, `v8js_*`) | 117 |
| `http_server_*` | 51 (3 route/method/status combinations x 17 rows) |

The per-process runtime estimate above (109) is close but slightly low —
`v8js_resource_active` reports more libuv handle types in the deployed pod
than the four seen locally. The budgeting model holds; only the label set
described in the previous section was wrong.

### Preview environments multiply the whole set

Each PR preview deploys with its own `OTEL_SERVICE_NAME`, so it becomes its
own `job` and carries a **complete** copy of the catalog above. Observed with
two previews live alongside dev:

```text
297  job=digital-trust-common-service
322  job=pr-398-digital-trust-common-service
322  job=pr-401-digital-trust-common-service
---
941  total
```

So the deployed cost is roughly `300 x (1 + open previews)` per environment,
not 300. This is the dominant growth term in dev by a wide margin — larger
than any single metric's dimensions — and it is invisible from the local
stack, which only ever runs one instance. Previews are short-lived and their
series go stale when the pods are removed, so this is a churn and
active-series consideration rather than unbounded growth, but a preview-heavy
week costs multiples of the steady-state figure.

## Selecting one deployment

A namespace runs dev alongside every open PR preview, so almost any useful query
needs to name one of them. The label that does this is **different in each
backend**, because a different collector owns each signal.

| signal | backend | selector |
| --- | --- | --- |
| metrics | Mimir | `{job="pr-401-digital-trust-common-service"}` |
| traces | Tempo | `{resource.service.name="pr-401-digital-trust-common-service"}` |
| logs | Loki | `{instance="pr-401-digital-trust-common-service"}` |

Metrics and traces both derive theirs from `OTEL_SERVICE_NAME`, which the chart
sets per environment and `pr-deploy.yml` makes per-PR, so the value is the same
in both and only the label name differs.

Logs are labelled by Alloy from Kubernetes pod metadata instead, and carry two
useful identifiers:

- `instance` — `app.kubernetes.io/instance`, the Helm release. Groups everything
  in one deployment, so the API and its UI share a value.
- `workload` — the owning Deployment or StatefulSet, with the ReplicaSet hash
  stripped so it survives rollouts. Separates the API
  (`digital-trust-common-service`) from its UI
  (`digital-trust-common-service-ui`).

Do **not** reach for `app` to tell deployments apart. It is
`app.kubernetes.io/name`, which identifies the *application* and is identical for
dev and every preview — one value covering all of them. `pod` does distinguish
them, but it changes on every rollout, so it works in an ad-hoc query and not in
a saved one or a dashboard variable.

`instance` and `workload` were added to the platform Alloy configuration on
2026-09-14; before that, `pod` really was the only option. The change is
forward-only, so log streams ingested earlier do not carry them.

## Findings

Verifying against a running stack surfaced items the original spec's
starting list didn't anticipate. Recorded here so they aren't rediscovered:

1. **The exported set is larger than the spec's starting list.**
   `http_client_request_duration_seconds` (outbound HTTP — currently just
   calls to the upstream OIDC issuer for discovery/token exchange) and the
   full Node.js/V8 runtime set (`nodejs_eventloop_*` beyond mean/p99,
   `v8js_gc_duration_seconds`, `v8js_memory_heap_*`, `v8js_resource_active`)
   are live today. All are bounded per the rule above (fixed
   dimension sets, not per-tenant or per-request identifiers) — no cardinality
   risk — but a metrics inventory that only lists the six names from the
   original spec is incomplete.
2. **`db_operation_name` carries whitespace-sensitive duplicates.**
   `@opentelemetry/instrumentation-pg` derives the operation name by
   trimming the query text and slicing to the first space character. A
   query written as `` `SELECT\n  ...` `` (verb immediately followed by a
   newline, common in multi-line template-literal SQL) produces
   `SELECT\n` as a distinct series from a query written `` `SELECT ...` ``
   on one line, which produces `SELECT`. Verified locally: nine distinct
   `db_operation_name` values for seven real verbs — `SELECT`, `INSERT`,
   `UPDATE`, `DELETE`, `CREATE`, `WITH` and `BEGIN`, with `SELECT\n`,
   `WITH\n` and `BEGIN;\n` reported as separate series for functionally
   identical operations, and confirmed deployed with the same nine values in
   Mimir. `BEGIN` was only ever observed as `BEGIN;\n`, so the duplication
   was `SELECT\n` and `WITH\n`: nine values carrying what seven do, at 12
   rows each, and any dashboard panel grouping by it split.

   **Fixed.** Reformatting the SQL was never an option: most of these come from
   pg-boss, whose `dist/plans.js` is written as multi-line template literals
   throughout, and `BEGIN;` is its transaction start. A metrics View on
   `db.client.operation.duration` normalizes the attribute at the SDK instead,
   which holds regardless of who wrote the SQL — see
   `libs/common/src/telemetry/db-operation-name.ts`. Trailing semicolons are
   stripped with it, so `BEGIN;` and `BEGIN` collapse. Series recorded before
   the fix age out of Mimir rather than disappearing.
3. **Unmatched routes have no `http_route` label at all**, rather than a
   placeholder value. A request to a path with no matching controller (a
   404) is grouped only by method and status, with `http_route` absent from
   the series. This is bounded (one bucket for "no route matched" per
   method/status pair) and expected, but worth knowing when a query filters
   on `http_route` and silently excludes unmatched-route traffic.
4. **The OIDC provider's internal routes collapse to a single `/oidc`
   `http_route`.** `oidc-provider` mounts its own internal router under
   `/oidc`, which isn't visible to the HTTP instrumentation's route
   matching beyond the Express mount path — so `/oidc/.well-known/openid-configuration`,
   token, and authorize endpoints all report `http_route="/oidc"` rather
   than their individual paths. Good for cardinality (one bucket instead of
   several), but means per-endpoint OIDC latency isn't visible from this
   metric alone.

## OTLP export confirmed end to end

Deployed, the full path is exercised: the app exports over OTLP to the
namespace's Alloy, which forwards metrics to Mimir via
`prometheus.remote_write` and traces to Tempo. Confirmed on 2026-09-14 against
`4a9599-dev`, with Alloy reporting accepted OTLP metric points and spans and no
refusals, and every metric in the catalog above queryable in Mimir under
`job="digital-trust-common-service"`.

Reaching the collector at all required two NetworkPolicy fixes in the platform
GitOps repository — Alloy had no ingress policy for its OTLP receivers, and
Tempo's dev and test policies had never rendered. See #324. Neither is a change
this repository makes, but a future environment reporting no telemetry should
rule them out before suspecting the application.

To reproduce against the deployed backend, querying Mimir through the
`metrics-dev` Grafana datasource:

```promql
# every metric exported by this service, with its series count
count by (__name__) ({job="digital-trust-common-service"})

# total active series for one instance
count({job="digital-trust-common-service"})

# every instance reporting, dev and any live PR previews
count by (job) ({job=~".*digital-trust-common-service.*"})

# resource attributes, which live here rather than on each series
target_info{job="digital-trust-common-service"}
```

## OTLP export confirmed from environment alone (local)

No code change was needed. `OTEL_METRICS_EXPORTER=otlp` and
`OTEL_EXPORTER_OTLP_ENDPOINT` (both in `.env.example`, both already read by
the SDK bootstrap in [tracing.ts](../libs/common/src/telemetry/tracing.ts))
are sufficient — confirmed by starting the local stack
(`docker compose --profile obs up -d db keycloak caddy lgtm`), running the
API, generating traffic, and querying Prometheus (via the Grafana datasource
proxy) for every metric name above under `service_name="digital-trust-common-service"`.

To reproduce, with the stack up and traffic generated, against
`http://localhost:3001/api/datasources/proxy/uid/prometheus/api/v1/query`:

```promql
# every metric exported by this service, with its series count
count by (__name__) ({service_name="digital-trust-common-service"})

# the label set and route/status combinations on the HTTP server histogram
http_server_request_duration_seconds_count

# the SQL verbs actually observed, including the whitespace duplicates above
count by (db_operation_name) (db_client_operation_duration_seconds_count)
```

Wrap a selector in `last_over_time(...[6h])` if the process has been stopped
for more than a few minutes — an instant query only looks back five.

## Reading these in Grafana

The committed dashboard
([observability/grafana/dashboards/digital-trust-local.json](../observability/grafana/dashboards/digital-trust-local.json))
already charts the core request/db/connection-pool panels plus event-loop
delay in its "Runtime & pipeline health" row; its panel queries were the
starting point for the catalog above and still resolve against the names
documented here. See [Local Observability Stack](./DEVELOPER.md#local-observability-stack)
for how to start the stack and confirm metrics locally.

**That dashboard is local-only, and deliberately so.** Its panels filter on
`service_name`, which does not exist in the deployed backend, so importing it
against `metrics-dev` renders every panel empty. The deployed equivalent is
provisioned separately into the shared Grafana's "Services" folder from the
platform GitOps repository, with the same panels rewritten against `job`.

The two cannot currently be one file. Merging them would mean either a query
form valid in both — there isn't one, since the label differs rather than the
value — or promoting resource attributes in Alloy, which costs the per-series
label bloat described above. Keeping two, each correct for its backend, is the
cheaper trade; this section exists so the divergence is found here rather than
in an empty dashboard.
