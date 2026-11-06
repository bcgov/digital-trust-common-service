# Log gateway verification

Automated isolation tests, the manual checks, the fairness benchmark and the recorded two-tenant check for the
identity-aware Loki gateway. The rules come from
[tenant-log-access-contract.md](tenant-log-access-contract.md) (section 7.2, Rules V1–V3, and
sections 9.2–9.3); the gateway itself is described in
[ARCHITECTURE.md](ARCHITECTURE.md#log-gateway). The manual checks and the benchmark run against a
**deployed** gateway in front of a real Loki.

Offline tests for the benchmark's shared client (no gateway needed): `npm run test:log-gateway:lib`.

## Prerequisites

- The gateway is deployed to the target environment (`logGateway.enabled: true`,
  `logAccess.enabled: true`) with its **own** Loki login. It must not reuse the Grafana login
  (`dts-grafana`).
- The collector writes agent partitions as `a-traction-<wallet_uuid>`. Only `t-<uuid>` and
  `a-traction-<uuid>` tenant headers are honoured; anything else lands in `dt-services`. In test and
  prod every `dts-alloy` write goes to `dt-services` until the per-partition write change ships, so
  real-Loki canary checks only work in dev for now.
- Tenant clients need both `logs:read` and `audit:read` where a check requests a token without
  `logs:read`.

## Automated isolation tests

The isolation cases (the positive, negative and allowlist rows of section 9.2) run hermetically in
CI, with no deployed environment: the real API and a recording stand-in for Loki run in the test
process, and Envoy runs in Docker with the configuration exactly as the chart renders it.

```bash
npm run test:log-gateway   # needs Docker, helm, yq and openssl
```

They prove the pieces this repository owns work together and that what reaches Loki is correct.
They cannot prove anything about a real Loki, the OpenShift Route, or Grafana, which is why the
checks below stay manual.

## Manual checks on a deployed gateway

Run these in **every** environment where tenants have access (V2, V3).

- **Real-Loki canary.** Push a distinct canary into tenant B's partition and into the platform
  partition `dt-services`, then confirm tenant A's token, through the real Route, never returns
  either. Tenants cannot read `dt-services`, so a 2xx push is the only proof it exists.
- **Scope label.** `GET /loki/api/v1/label/__tenant_id__/values` should return exactly the caller's
  partitions. Loki answers it from the scope itself; confirm that on the first dev run.
- **Route behaviour.** If the OpenShift router changes or refuses a raw path (`..`, `%2e%2e`, `//`,
  `%2F`) before the gateway sees it, record that here. A wrong `Host` through the Route never
  reaches the gateway, so spoofed-`Host` checks need a port-forward to the gateway Service.
- **N13.** nginx in front of Loki rejects a Bearer token, so any successful query shows the
  caller's token was replaced by the gateway's Loki login. The contract's wording, "no
  `Authorization` header present", does not match: the gateway sends its own login. The contract is
  unchanged; this is a mismatch to settle.
- **N16 / S6.** Check **every** API pod for the decision endpoint's log lines:

  ```bash
  for pod in $(kubectl get pods -n <namespace> -l app.kubernetes.io/name=digital-trust-common-service -o name); do
    kubectl logs -n <namespace> "$pod" --since=15m \
      | grep -E 'Tenant-selecting query parameter ignored|Inbound scope header ignored'
  done
  ```

  S5 attempts appear in the gateway access log. Tenant-selecting fields in a **POST body** are
  ignored but not recorded; whether that satisfies S6 is an open question.

Not covered by either: N2, N21–N25, N28, N29, N36, N38–N40 (other components), and P4, P8–P11
(Grafana or other components).

## Fairness benchmark (N37)

```bash
LOG_GATEWAY_URL=https://<gateway-route> TOKEN_URL=https://<api>/oidc/token \
LOG_GATEWAY_AUDIENCE=<LOG_GATEWAY_AUDIENCE> \
TENANT_A_ID=<uuid> TENANT_A_CLIENT_ID=... TENANT_A_CLIENT_SECRET=... \
TENANT_B_ID=<uuid> TENANT_B_CLIENT_ID=... TENANT_B_CLIENT_SECRET=... \
BENCH_QUERY='{service_name=~".+"}' \
BENCH_QUERIER_REPLICAS=<n> BENCH_QUERIER_CONCURRENCY=<n> \
BENCH_SCOPE_PARTITIONS=2 \
PROM_URL=... PROM_PEAK_QUERY='<noisy tenant in-flight sub-queries>' \
npm run benchmark:log-gateway
```

Follows the reference load of Rule L11: a baseline with the victim alone, then the victim under a
noisy tenant saturating its allowance, at least 20 successful runs over at least 10 minutes each, through the
gateway. A phase is extended for more successes but stops at twice its window.

- `BENCH_RANGE_HOURS` (default `168`) and `BENCH_ENTRY_LIMIT` (default `2000`) are the maximum
  Loki permits in dev (`max_query_length`, `max_entries_limit_per_query`), which is what L11
  wants. **Confirm both from the target environment's live config**; an entry limit above the
  backend's is answered with a `400` on every request.
- `BENCH_QUERIER_REPLICAS` and `BENCH_QUERIER_CONCURRENCY` are required. The tool prints
  `cap = replicas × concurrency / 3` (dev: 1 read pod, `max_concurrent` 4).
- `BENCH_SCOPE_PARTITIONS` is only a label in the output and is **not verified**. Confirm the
  scope size yourself, and run at 2 and at 10 partitions with representative volume in every
  partition.
- `PROM_URL` and `PROM_PEAK_QUERY` supply the noisy tenant's peak concurrent sub-queries. If the
  lookup fails or the value is missing, the run fails. The query must return **one series, already
  aggregated for the noisy tenant**; zero or several series count as not recorded. Loki exposes no per-tenant in-flight
  metric, so which query to use is **undecided**; settle it before relying on `capacityCapHeld`.

The verdict passes only if all of these hold:

| Field                                                  | Meaning                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baselineSamplesSufficient`, `loadedSamplesSufficient` | At least `BENCH_RUNS` (min 20) **successful** samples in each phase. p95 is computed from successes only, so a run with no working queries cannot pass                                                                                                                                                  |
| `latencyUnder10s`, `withinTwiceBaseline`               | Loaded p95 ≤ 10 s and ≤ 2× the baseline p95                                                                                                                                                                                                                                                             |
| `noErrorIncrease`                                      | Loaded error rate ≤ baseline error rate                                                                                                                                                                                                                                                                 |
| `noCacheHits`                                          | `data.stats.cache.result` (`entriesFound`, `queryLengthServed`) is zero in every 200 of baseline, loaded **and** noisy queries, and the stats are present in every one                                                                                                                                  |
| `noisyLoadSustained`                                   | At most 10% of the noisy tenant's queries were non-200. The threshold is a judgement call, not a contract value: the decision endpoint allows 120 requests a minute per tenant, so fast refused queries would collapse the load and make the victim's latency meaningless. Counts by status are printed |
| `capacityCapHeld`                                      | Recorded peak ≤ cap                                                                                                                                                                                                                                                                                     |

The tool does not enforce any capacity limit; it measures and reports. Confirm from Loki's own
metrics too that no run was served from the results cache. Re-run when querier replicas or
per-querier concurrency change. Post the JSON output on the tracking issue.

## Section 9.3 end-to-end record

Record on the tracking issue, per tenant (two real tenants, each with a connector and both
service and agent activity), using a real token through the real chain:

1. Dashboard: both own sources visible, none of the other tenant's.
2. Ad-hoc query (Explore): the same.
3. Label enumeration (labels, label values, series): the same.
4. Live tail returns the generic `403` (Rule G10).
5. Adversarial set: spoofed partition header, wrong audience, missing scope, a query naming the
   other tenant with a canary in place, and an attempt to bind the other tenant's agent
   identifier.

Steps 1–3 are manual through Grafana; step 4 and most of step 5 are also covered by the automated
tests, apart from the bind attempt, which is an API call to this service. Include the tenant-B
canary check in real Loki from the manual checks above.
