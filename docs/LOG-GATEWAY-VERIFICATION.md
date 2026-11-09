# Log gateway verification

Automated isolation tests, the manual checks, and the recorded two-tenant check for the
identity-aware Loki gateway. The rules come from
[tenant-log-access-contract.md](tenant-log-access-contract.md) (section 7.2, Rules V1–V3, and
sections 9.2–9.3); the gateway itself is described in
[ARCHITECTURE.md](ARCHITECTURE.md#log-gateway). The manual checks run against a
**deployed** gateway in front of a real Loki.

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
docker compose --profile test up -d db-test migrate-test seed-test
npm run test:log-gateway   # also needs Docker, helm, yq and openssl
docker compose --profile test down -v
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

Not covered by either: N2, N21–N25, N28, N29, N36–N40 (other components), and P4, P8–P11
(Grafana or other components).

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
