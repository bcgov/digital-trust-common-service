# Baseline OpenTelemetry Metrics

This is the cardinality contract for the metrics digital-trust-common-service
exports today. It exists so a later ticket that wants to add a metric, or a
label to an existing one, has a number and a rule to be judged against instead
of a feeling.

**No instruments are defined in application code.** Every metric below comes
from OpenTelemetry auto-instrumentation (`@opentelemetry/auto-instrumentations-node`,
which bundles `instrumentation-http`, `instrumentation-pg`, and
`instrumentation-runtime-node`) wired up in
[tracing.ts](../libs/common/src/telemetry/tracing.ts). There is no `getMeter`,
counter, or histogram anywhere in the codebase. Business metrics (credential
operations, queue depth) are later, separate tickets and must cite the rule
below rather than re-litigate it.

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

Every series above also carries a small fixed set of resource attributes —
`service_name`, `deployment_environment_name` and `host_name` — the same
values on every series from one process, so they don't multiply cardinality
per request. The rest of the resource (`host_id`, `host_arch`, `process_*`,
`telemetry_sdk_*`) is not copied onto each metric: the Prometheus OTLP
receiver puts it on a single `target_info` series and you join it in at
query time. That keeps the per-series label set small, and it means a query
filtering on, say, `process_pid` needs that join rather than a plain
selector.

`host_name` is worth knowing about specifically: on OpenShift it's the pod
name, so it changes on every restart or rollout. That's expected Prometheus
churn, not a per-tenant leak, but it means historical queries across a
deployment need to aggregate away `host_name` rather than pin to it.

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
`INSERT`, `UPDATE`, `DELETE`, `CREATE`, `WITH`, plus the newline-suffixed
duplicates below.

Runtime metrics (`nodejs_*`, `v8js_*`) are fixed per process regardless of
traffic: 7 event-loop-delay gauges + 2 event-loop-time rows + 1 utilization +
51 GC rows (15 buckets × 3 GC types, plus a `_count` and a `_sum` each) + 44
heap rows (11 heap spaces × 4 heap metrics) + 4 `v8js_resource_active` rows =
**109 series**, present the moment the process starts, independent of any
request.

None of this is unbounded: the only user-influenced input is which of the 58
route templates and which statement verbs get exercised, both fixed sets
enumerable from the codebase — not from request content.

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
   `db_operation_name` values for six real verbs — `SELECT`, `INSERT`,
   `UPDATE`, `DELETE`, `CREATE` and `WITH`, plus `SELECT\n`, `WITH\n` and
   `BEGIN;\n` as separate series for functionally identical operations. That
   inflates the effective `db_operation_name` cardinality by half again
   without adding any real information; it's a data-quality wrinkle worth being aware of when
   reading the dashboard, not a fix this ticket makes (no code changes —
   see Non-goals).
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

## OTLP export confirmed from environment alone

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
