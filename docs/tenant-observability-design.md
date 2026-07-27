# Spike: Self-Serve Tenant-Scoped Grafana Dashboards

**Issue**: [bcgov/vc-common-service#103](https://github.com/bcgov/vc-common-service/issues/103)
**Status**: Approach decided — Grafana + identity-aware gateway; Traction-only MVP; app-issued tokens (reconciled with infra review)
**Started**: 2026-06-30
**Last updated**: 2026-07-24

---

## Overview

This document captures the research and the resulting design decisions for enabling **tenant-scoped observability** — letting a tenant self-serve access to dashboards scoped to only their own data. For the MVP the relevant services are **vc-common-service** (greenfield NestJS service) and **Traction (ACA-Py)**, its sole credential-agent backend.

The requirements that shape the design:

- **Enforcement, not just UX scoping**: a tenant must not be able to circumvent filters to view another tenant's data. Multiple tenants may be active simultaneously, each fully isolated.
- **Scale**: the design must work at **hundreds to thousands of tenants**. Any approach requiring per-tenant Grafana resources (orgs, datasources, dashboard copies) is ruled out — per-tenant cost on the access layer must be near zero.
- **Self-serve**: tenant onboarding must not require operator intervention to make observability available.

A secondary, **platform-internal** goal is request tracing for troubleshooting (see [Tracing & Metrics](#tracing--metrics-platform-internal)). Tenant-facing scope for MVP is **logs, deliberately**.

### Decisions

Three decisions frame everything below and supersede parts of the original research:

1. **Traction-only MVP.** Cross-service correlation across vc-authn-oidc, the Endorser, and the Mediator is **out of scope** for MVP (it needs a dynamic, multi-identifier registry and DIDComm-boundary work). The tenant identity mapping collapses to a single static pair — **vc-common-service `tenant_id` → Traction `traction_tenant_id`** — which the design already stores per tenant in `ConnectorCredential` (PE-06). Multi-service correlation is captured as post-MVP.
2. **Grafana for tenant-facing views** (identity-aware gateway + a **dedicated tenant-facing Grafana instance** + generic dashboards), **chosen over** rendering log views inside vc-common-service. A dedicated instance is used rather than a second org on the platform Grafana because that instance already has a single `generic_oauth` provider (Keycloak) and cannot host a second (tenant) provider. This supersedes the in-app log-query-service + terminal-console path (requirements OB-07 + UI-08).
3. **App-issued tokens, not direct Keycloak.** Grafana authenticates as an **OIDC client of vc-common-service's own `oidc-provider`**, which federates upstream to Keycloak for human login. Grafana forwards the **app-issued** token; the identity-aware gateway validates it against vc-common-service's JWKS — the **same validation as the API's JWT guard (AU-03)** — and reads `tenant_id` from an app-issued claim. This removes all Keycloak group/claim-mapping work.

**TL;DR of the design**:

- Enable native Loki multi-tenancy (`auth_enabled: true`); Alloy routes each log line to a per-tenant Loki tenant via `stage.tenant`, keyed on `traction_tenant_id` (Traction/ACA-Py) or `tenant_id` (vc-common-service). Enforcement is in the storage layer itself. **Prerequisite**: Traction must emit JSON logs carrying its sub-tenant id (via `ACAPY_LOG_CONFIG`) — see [Getting identifiers into log streams](#getting-identifiers-into-log-streams).
- Reuse the existing per-tenant **`ConnectorCredential`** record (PE-06) as the `tenant_id → traction_tenant_id` mapping — no new registry entity.
- **Auth flow**: Grafana → vc-common-service `oidc-provider` → Keycloak (upstream). Grafana forwards the app-issued access token; a small **identity-aware gateway** in front of Loki validates it **and requires the `logs:read` scope** (fail closed), resolves `tenant_id → traction_tenant_id` from `ConnectorCredential`, and sets a pipe-joined `X-Scope-OrgID: tenant_id|traction_tenant_id` — so a tenant sees **both** its vc-common-service and its Traction logs. Zero per-tenant Grafana resources — a **dedicated tenant-facing Grafana instance** with one org, one datasource, one set of generic dashboards.
- A **conservative global Loki `limits_config`** is required before exposing arbitrary LogQL to external tenants; **the auth foundation this depends on (`oidc-provider`, JWT issuance/validation, guards, `logs:read`) is spec-only today** — Phase 2 depends on it landing first.
- Keep **traces and metrics platform-internal**, tagged with `tenant.id` for filtering when assisting tenants.

---

## Current Stack State

Understanding what we're starting from is essential before evaluating options.

| Component | Version | Multi-tenancy mode | Notes |
|-----------|---------|-------------------|-------|
| Grafana | 13.0.1 (chart 12.3.1) | Single org (org 1) | Deployed only in `ca7f8f-test`; stateless pods backed by external Postgres; exactly one active `generic_oauth` provider (Keycloak) |
| Loki | 3.7.2 (chart 17.4.7) | `auth_enabled: false` | Single tenant "fake"; sits behind an **nginx + basic-auth gateway**; no label enforcement |
| Mimir | unknown | Appears single-tenant | Gateway adds `X-Scope-OrgID` but no auth enforced |
| Tempo | dev/test `tempo` 2.7.1 (single-binary); prod `tempo-distributed` 2.9.0 | `multitenancy_enabled` unset (default false) | Single-tenant mode |
| Alloy | v1.15.0 (chart 1.7.0) | N/A (collector only) | Today runs `static_labels` + `label_keep` only; `stage.tenant` routing is net-new |

**Key facts about Grafana today:**

- Single shared instance in `ca7f8f-test`
- All datasources provisioned in org 1 via `values.yaml` (not sidecar)
- Keycloak role mapping: `grafanaadmin → GrafanaAdmin`, `admin → Admin`, `editor → Editor`, `viewer → Viewer`
- No per-tenant orgs, folders, or dashboard restrictions exist
- No `auto_assign_org` configured — new OAuth users land in org 1 by default
- **Only one `generic_oauth` provider** can be active on this instance — a second (tenant) provider cannot coexist, which is why the tenant-facing design uses a **dedicated Grafana instance** rather than a second org here

> **Target change**: the tenant-facing design replaces Grafana's IdP — instead of authenticating directly against Keycloak, Grafana becomes an OIDC client of **vc-common-service's `oidc-provider`** (which federates upstream to Keycloak). See the Auth Integration section below.

**Key facts about Loki today:**

- `auth_enabled: false` means ALL data lives under tenant ID `"fake"`
- No `tenant_id` or application-level VC tenant label is present in stored streams
- Alloy collects logs tagged only with Kubernetes metadata (namespace, pod, container, app), through a `loki.process` pipeline per namespace ([infra/monitoring/alloy/values.yaml](../infra/monitoring/alloy/values.yaml)) — relevant because tenant routing (below) slots into this existing pipeline
- There is no label today that maps a log line to a VC tenant (tenant_id / agent_id)
- Loki sits behind an **nginx + basic-auth gateway** today (not exposed directly)
- **Shared Loki**: the BC Wallet team pushes logs to this same Loki **directly** (curl + basic auth, bypassing Alloy); their data currently lands under the `"fake"` tenant — this makes the `auth_enabled: true` cutover a coordinated change, not a solo flip (see [Loki Multi-Tenancy](#loki-multi-tenancy-and-label-enforcement))

**In-flight work relevant to this spike:**

- OpenTelemetry instrumentation is being rolled out across our services — this directly feeds the Tracing & Metrics section

---

## Tenant Identity (MVP: Traction)

> **Context**: `bcgov/vc-common-service` is greenfield — it can be designed from day one to emit a structured `tenant_id` in its logs. Its calls to Traction are already attributed to the right sub-tenant by the Bearer token they carry.

For the MVP there are exactly two identifiers to correlate, and the mapping between them is **static and one-to-one**:

| Service | Tenant identifier | In logs via |
|---------|-------------------|-------------|
| **vc-common-service** | `tenant_id` (app-owned) | structured JSON logging (pino, OB-09) |
| **Traction / ACA-Py** | Traction's sub-tenant id (stored by us as `traction_tenant_id`) | ACA-Py stamps the sub-tenant identity onto each log record via a contextvar in multitenant mode. It surfaces **only** once Traction is configured to log JSON (see below). Attribution needs no inbound header — the sub-tenant is resolved from the Bearer token on our calls. |

### The mapping — reuse `ConnectorCredential` (PE-06)

This mapping is **not a new entity**. The design already stores each tenant's Traction identity in the per-tenant **`ConnectorCredential`** record (PE-06): it holds `traction_tenant_id` alongside the connector's `api_key` and `endpoint_url`, CT-01 reads it to configure the adapter, and CT-06 already resolves the internal `tenant_id` **from** `traction_tenant_id` on inbound webhooks. The gateway needs the exact reverse — `tenant_id → traction_tenant_id` — from the same record.

At query time the gateway (cached): receives an app-issued token carrying `tenant_id`, looks up `traction_tenant_id` in `ConnectorCredential`, and sets a pipe-joined Loki tenant scope (`X-Scope-OrgID: tenant_id|traction_tenant_id`) covering **both** the vc-common-service stream (ingested under `tenant_id`) and the Traction stream (ingested under `traction_tenant_id`). The gateway never parses or rewrites the query — it only translates identity into a tenant scope that Loki itself enforces. Per-tenant cost: one existing row.

> **Reconciliation note**: `ConnectorCredential` is a planned **P0** entity (PE-06); today only the `Connection` entity exists in code. `Connection.externalConnectionId` is **not** the right home — it is per-DIDComm-connection, not per-tenant Traction identity. Also, `traction_tenant_id` should be a **queryable (indexed, plaintext) column** on `ConnectorCredential` rather than buried inside the encrypted `credentials` blob — CT-06 already needs to query by it, and so does the gateway. The `api_key` stays encrypted; `traction_tenant_id` is an identifier, not a secret.

### Getting identifiers into log streams

- **vc-common-service**: log `tenant_id` in structured JSON from day one (OB-09). Outbound calls to the Traction API are already attributed to the sub-tenant via the **Bearer token** they carry — ACA-Py stamps the sub-tenant identity onto every log record (via a contextvar) in multitenant mode, so **no `X-Wallet-ID` (or any inbound wallet header) is involved** (OB-08).
- **Traction / ACA-Py**: two prerequisites, both real work:
  1. **Traction must emit JSON logs.** Our Traction deployment logs **plain text** today — no `ACAPY_LOG_CONFIG` / `--log-config` is wired up in the charts. The sub-tenant id is on the log record (contextvar) but the default format doesn't print it. Emitting it needs a **log-config change on the Traction deployment** (gitops in the Traction repo).
  2. **Then** Alloy extracts it with `stage.json` on the clean field. Against today's plain-text logs `stage.json` does nothing; a `stage.regex` fallback on plain text is brittle and would turn log-format drift into a tenant-isolation incident. Get Traction emitting JSON **first**.

### Post-MVP: multi-service correlation

Correlating vc-authn-oidc, the Endorser, and the Mediator is deferred. Those services identify a tenant by `connection_id` / DID and communicate over DIDComm (no HTTP header to propagate), so correlation there needs a **dynamic, multi-identifier registry** and DIDComm-boundary work. When needed, `ConnectorCredential` (or a companion table) gains additional identifier columns (`vc_authn_connection_id`, `endorser_did`, …) and the gateway pipe-joins them into `X-Scope-OrgID`. Out of scope for MVP.

### Open questions

- [ ] Confirm the exact Traction log field and format once `ACAPY_LOG_CONFIG` is enabled — is the sub-tenant surfaced as `tenant_id` or `wallet_id`? **(Load-bearing — verify against actual pod logs; drives the `stage.json` field name and the `traction_tenant_id` column.)**
- [ ] Confirm the app-issued token claim name for the tenant key aligns with the API's `tenant_id` claim (AU-03/AU-05), so the gateway and API validate identically.

---

## Loki Multi-Tenancy and Label Enforcement

Loki offers two models for tenant isolation. They are very different in implementation and security.

### Model 2A: Native multi-tenancy (`auth_enabled: true`) — recommended

When `auth_enabled: true`, Loki requires an `X-Scope-OrgID` header on every request. Data is stored and queried per tenant ID with complete isolation — a query for tenant `abc` cannot see tenant `xyz`'s data. This is enforcement in the storage layer itself, not in any component we build.

**The key enabler: per-log-line tenant routing at the collector.** Shared multi-tenant pods are not a blocker. Alloy's `loki.process` pipeline supports a `stage.tenant` block that sets the Loki tenant ID per log line, sourced from a label or a field extracted from the log body (this depends on Traction emitting **JSON** logs first — see [Getting identifiers into log streams](#getting-identifiers-into-log-streams)):

```text
stage.json  { expressions = { traction_tenant_id = "..." } }  // extract from Traction JSON log
stage.tenant { source = "traction_tenant_id" }                // route line to that Loki tenant
```

A single Traction pod's log stream is split by the collector into per-tenant Loki tenants based on the `traction_tenant_id` in each line. Lines with no extractable identifier fall through to a default platform tenant, so services not yet in scope (vc-authn-oidc, Endorser, Mediator — post-MVP) keep working unchanged. Using the raw identifier (e.g. `traction_tenant_id`) as the Loki tenant ID keeps the Alloy config **static** — no per-tenant collector config or reload on tenant onboarding. **Note**: our Alloy runs `static_labels` + `label_keep` today, not a `stage.json`/`stage.tenant` pipeline — this routing is net-new pipeline work.

**Cross-tenant querying**: tenant IDs can be pipe-joined in the header (`X-Scope-OrgID: a|b|…`) when `multi_tenant_queries_enabled: true` is set. **This is required even for MVP**: each tenant's scope already spans **two** Loki tenants — its vc-common-service stream (under `tenant_id`) and its Traction stream (under `traction_tenant_id`) — so the gateway sets `X-Scope-OrgID: tenant_id|traction_tenant_id`. Platform dashboards pipe-join across all tenants the same way.

### Query limits are a prerequisite for exposure

We are about to expose **arbitrary LogQL** to external tenants, and Loki has **no query limits configured today**. A conservative **global `limits_config`** (max query length / series / rate / cardinality) must land **before** exposure — it is one global config, enforced per-tenant automatically. Per-tenant overrides are for exceptions only (e.g. ingest headroom for the BC Wallet push tenant — see Migration).

### Migration is not zero: two ingestion paths + external push consumers

Flipping `auth_enabled: true` makes `X-Scope-OrgID` **mandatory on every request, ingest included** — and there are **two** ingestion paths, only one of which `stage.tenant` covers:

- **In-cluster**: services + Traction → **Alloy** → `stage.tenant` sets the header. ✅ covered.
- **External direct push**: the **BC Wallet** team pushes via `curl` + basic auth → the **nginx gateway** → Loki. **No Alloy, no `stage.tenant`.** The moment we cut over, their existing curl (basic auth, no org header) starts getting `401 no org id`. Basic auth ≠ tenant header — the two are unrelated.

The fix is to assign that tenant **at the nginx gateway**, injecting the header off the basic-auth identity so their client doesn't change:

```nginx
# on the Loki push location, after basic-auth
proxy_set_header X-Scope-OrgID $remote_user;
```

Their basic-auth username becomes their Loki tenant; `proxy_set_header` overwrites, so a client can't spoof `X-Scope-OrgID` either. Three decisions fold in:

1. **Tenant name / continuity** — their data is under `"fake"` today. Give them a named tenant (e.g. `bcwallet`) going forward and pipe-join `fake|bcwallet` in platform dashboards during the transition; old `"fake"` data stays queryable.
2. **Limits** — the conservative global `limits_config` could throttle the wallet team's app-fleet push volume, so give their tenant a **per-tenant override** (higher `ingestion_rate_mb`/burst). This is the concrete reason the override file exists.
3. **Sequencing** — a coordinated change, not a solo flip: configure the nginx injection **before/atomic with** `auth_enabled: true`, verify their push still returns `204` in dev, then cut over test/prod. Loop the wallet team in before the prod flip even though their client shouldn't need to change — a silent `401` storm on their logging burns cross-team trust.

Platform data itself needs **no migration**: existing `"fake"` data stays queryable; platform dashboards query `"fake"` plus new per-tenant IDs (pipe-joined). Tenant-scoped views only see data ingested after the switch — new consumers with no historical-data expectation.

**Scale**: Loki is designed for very large tenant counts (Grafana Cloud operates it at orders of magnitude beyond our scale). At thousands of tenants the practical considerations are per-tenant object-storage overhead for tiny tenants (acceptable) and keeping `limits_config` defaults sane. Per-tenant rate limits and retention come for free.

### Model 2B: Label-based filtering without enforcement — rejected

Keep `auth_enabled: false`, add a `tenant_id` Loki label to streams, and constrain dashboard queries via variables (`{tenant_id="xxx"}`).

This provides **no security boundary**. OSS Loki has no query-level label enforcement, and Grafana-side restrictions don't close the gap: any authenticated Grafana user — Viewer included — can POST arbitrary LogQL directly to Grafana's datasource query API (`/api/ds/query`) with their session cookie, against any datasource in their org. Restricting dashboard editing or disabling Explore is UX, never a security boundary. Real enforcement must live at the datasource/backend level. Given the issue's explicit enforcement requirement, this model is out.

### Model 2C: Query-rewriting proxy — rejected

A proxy in front of Loki parses incoming LogQL and injects a mandatory label matcher per tenant (`loki-multi-tenant-proxy` is an — largely unmaintained — open-source example).

Rejected because it places query-parsing logic in the security-critical path to achieve what Loki's native tenancy (Model 2A) already provides. Note the distinction from the identity-aware gateway in the recommended architecture: that gateway **never touches the query** — it only maps an authenticated identity to an `X-Scope-OrgID` header value, and Loki does the enforcing. Header mapping is a few dozen lines of logic; LogQL rewriting is a parser you must keep correct forever.

### Loki findings summary

| Capability | OSS Loki | Notes |
|-----------|----------|-------|
| Multi-tenancy (storage isolation) | ✅ (`auth_enabled: true`) | Recommended; no data migration needed |
| Per-log-line tenant routing at collector | ✅ (Alloy `stage.tenant`) | Works with shared multi-tenant pods |
| Cross-tenant queries (pipe-joined IDs) | ✅ (`multi_tenant_queries_enabled`) | Used for tenant scopes and platform views |
| Label-based query filtering | ✅ (no enforcement) | UX only — not a security boundary |
| Query-level label enforcement | ❌ | Not available in OSS |
| Per-tenant rate limits / retention | ✅ (in multi-tenant mode) | `limits_config` per tenant |

### Open questions

- [ ] Confirm the Alloy version supports `stage.tenant` (v1.15.0 is recent; expected yes)
- [ ] Define the global `limits_config` values (max query length / series / rate / cardinality) before exposure, plus the `bcwallet` per-tenant override
- [ ] Validate write-path behavior when `auth_enabled` flips to true — confirm nothing in our gateway/nginx strips or overwrites `X-Scope-OrgID`, and that the nginx push-path injection lands atomically with the flip
- [ ] Decide the default/fallback tenant name for unattributed lines (e.g. keep `"fake"` vs. an explicit `platform` tenant)
- [ ] Object-storage overhead check: index/chunk footprint for a large number of low-volume tenants

---

## Grafana Access Layer at Scale

### The scale constraint rules out per-tenant Grafana resources

Grafana OSS organizations provide real isolation (per-org dashboards, datasources, users), and OIDC `org_mapping` can route users to orgs. On paper, "one org + one datasource per tenant" gives clean isolation. **At hundreds to thousands of tenants this collapses**:

- Thousands of orgs, datasources, and dashboard copies to create, migrate, and keep in sync on every dashboard change and every Grafana upgrade
- Grafana's own guidance discourages heavy multi-org use (maintained, but not a development focus; newer features are org-1-centric)
- Cross-org automation requires server-admin (basic auth) credentials — a wide-blast-radius credential exercised on every onboarding
- Admin UX (org switcher, user management) degrades badly at that count

Per-tenant Grafana resources are therefore **rejected**. The access layer must have near-zero per-tenant cost.

### Scalable model: a dedicated tenant Grafana instance + identity-aware gateway

The design that scales moves tenant identity out of Grafana configuration entirely and derives it from the **authenticated user's token at query time**. It runs on a **dedicated tenant-facing Grafana instance** (not a second org on the platform Grafana):

1. **A dedicated tenant Grafana instance** — its own deployment (stateless pods + its own Postgres, provisioned-only), a single default org for all tenant users as Viewers. A separate instance is required because the platform Grafana already has one active `generic_oauth` provider (Keycloak) and cannot host a second (tenant) provider; a dedicated instance also gives stronger isolation.
2. **One Loki datasource** on that instance, with **"Forward OAuth Identity"** (`oauthPassThru: true`) enabled — Grafana forwards the logged-in user's **app-issued access token** (from vc-common-service's `oidc-provider`) with every datasource request.
3. **An identity-aware gateway** (small NestJS/Go service, or nginx `auth_request` + a resolver) sits between that datasource and Loki. Per request it: validates the app-issued JWT against vc-common-service's JWKS (same validation as the API's guard, AU-03); **requires the `logs:read` scope and fails closed if absent** (authorize, don't just authenticate); reads `tenant_id` from the token claim; looks up `traction_tenant_id` in `ConnectorCredential` (cached); sets `X-Scope-OrgID: tenant_id|traction_tenant_id` (both the vc-common-service and Traction streams); strips the Authorization header; forwards to Loki. It never reads the query.
4. **Generic shared dashboards**: because data scoping comes from identity, a single set of dashboards serves every tenant — each tenant sees only their own data in the same dashboard. No per-tenant dashboard provisioning, no template variable substitution, and Explore is safe too.

> **Existing gateway**: there is already an **nginx + basic-auth gateway** in front of Loki. So the real decision is "**replace** that basic-auth layer with the identity-aware one" vs "**chain** them (nginx basic-auth for the write/push path, identity-aware gateway for the read path)" — not a greenfield placement. The Migration section already relies on the nginx layer for external-push tenant injection, which argues for chaining.

> **`logs:read` reconciliation**: `logs:read` is a docs-only scope today, and the role enum is `OWNER / ADMIN / MEMBER / READONLY` (not "tenant-admin/tenant-owner") — reconcile the naming when the scope is seeded (AU-04).

**Per-tenant footprint in this model: zero Grafana objects.** Onboarding touches only the existing `ConnectorCredential` row (the tenant binding is the app-issued `tenant_id` claim vc-common-service already mints).

Grafana is registered once as an `authorization_code` (interactive, PKCE) client of vc-common-service's `oidc-provider`. A single static `org_mapping` rule routes all tenant users → the tenant org as Viewer, keyed on an app-issued claim — no Keycloak group design, and no per-tenant mapping.

**Trade-offs to carry into implementation:**

- The gateway is a custom component in the security path. This is acceptable because its job is narrow (JWT validation + `logs:read` authorization + header mapping — no query parsing), it fails closed, and it is the same pattern Grafana Enterprise LBAC and Mimir/GEM gateways implement commercially. It must be treated as security-critical code: reviewed, tested, minimal.
- `oauthPassThru` forwards the user's app-issued access token; token lifetime must comfortably exceed dashboard refresh intervals. Because vc-common-service issues and refreshes these tokens (AU-01/AU-08), lifetime is ours to configure — but the access token must be a **JWT carrying `tenant_id`** (configure `oidc-provider` for JWT access tokens) and scoped with an audience the gateway accepts (`aud = loki-gateway`, via resource indicator), so the gateway can validate statelessly.
- Grafana **alerting** evaluates rules server-side with no user identity — per-tenant alerting does not work in this model and is out of scope.
- Tenant users share one org, so they can see the same *dashboard definitions* (not data). Dashboards must not embed anything tenant-specific.

### Public dashboards / embedding

- Public dashboards (shareable external URLs without login) are available in Grafana OSS, but template variables are NOT supported in them — a parameterized per-tenant public URL is not possible. Not usable here.
- iframe embedding of authenticated Grafana works but requires **`allow_embedding = true`** (currently **unset** — defaults to false) plus a CSP `frame-ancestors` allowance for the admin-dashboard origin. Scoping still follows the logged-in user. This is the mechanism UI-08 uses to surface the tenant log view; decide which Grafana instance is embedded (the dedicated tenant instance).

### Grafana findings summary

| Capability | OSS Grafana 13 | Notes |
|-----------|---------------|-------|
| Per-tenant orgs/datasources | ✅ but **rejected** | Does not scale to hundreds/thousands of tenants |
| Forward OAuth identity to datasource | ✅ (`oauthPassThru`) | The key enabler for the gateway model |
| OIDC client of vc-common-service | ✅ (generic OAuth) | Grafana points at the app `oidc-provider`, not Keycloak directly |
| Second OAuth provider on platform Grafana | ❌ | Only one `generic_oauth` active → dedicated tenant instance required |
| App-claim → org mapping | ✅ (`org_mapping`) | One static rule (all tenants → the tenant org) |
| Datasource permissions within an org | ❌ Enterprise only | Not needed — scoping is identity-based |
| iframe embedding | ✅ (`allow_embedding = true`, unset today) | Needs enabling + CSP `frame-ancestors` |

### Open questions

- [ ] Confirm `oidc-provider` is configured for **interactive `authorization_code` + PKCE** (AU-01) and **JWT access tokens** carrying `tenant_id` — the gateway depends on both. (See the "spec-only foundation" note in Auth Integration.)
- [ ] Validate `oauthPassThru` + app-token refresh behavior on the tenant Grafana instance (long-lived dashboard sessions).
- [ ] Gateway placement: **replace** the existing nginx basic-auth layer vs **chain** with it (chaining preferred — the write path needs nginx for external-push injection).
- [ ] Enable `allow_embedding = true` + CSP `frame-ancestors` on the tenant Grafana instance for UI-08.

---

## Self-Serve Provisioning Flow

With the identity-aware gateway model, per-tenant provisioning becomes **thin** — there are no Grafana objects to create per tenant.

### Trigger point

vc-common-service is the source of truth for tenant lifecycle. When a tenant is provisioned/configured, downstream actions fire — as part of the same onboarding transaction vc-common-service already runs (it is greenfield; design the hooks in).

### Provisioning steps (per tenant)

1. Populate the tenant's `ConnectorCredential` (PE-06) with its `traction_tenant_id` (Tenant Identity section) — the same per-tenant record the adapter already needs (CT-01), written when the connector is configured.
2. — that's it. The tenant binding is the app-issued `tenant_id` claim vc-common-service already mints at login; the gateway resolves `traction_tenant_id` at query time; dashboards are shared.

One-time (not per-tenant) setup: the dedicated tenant Grafana instance (single org), the OAuth-forwarding datasource, the generic dashboard set (JSON in the gitops repo, provisioned normally), the static `org_mapping` rule, Grafana registered as an OIDC client of vc-common-service, and the gateway deployment.

If a tenant's connector changes (e.g. re-provisioned Traction sub-tenant), the `ConnectorCredential` row is updated; the gateway's next cache refresh picks it up. No Grafana interaction.

### Tools

Because per-tenant provisioning reduces to "populate the connector record," no dedicated provisioning machinery (Terraform provider, Grafana Operator, provisioner service) is needed. The one-time Grafana + OIDC-client setup uses the normal gitops path.

### Open questions

- [ ] Gateway `ConnectorCredential` lookup: direct DB read vs. an internal API on vc-common-service; cache TTL and invalidation on connector updates.
- [ ] Should generic tenant dashboards be per-env (dev/test/prod datasources) or start with one env?

---

## Auth Integration and Security Boundaries

### Current auth model

Today, platform users log into Grafana via Keycloak SSO directly, land in org 1, and their Grafana role (`Viewer`/`Editor`/`Admin`) comes from a Keycloak role claim. This platform-team setup stays as-is.

### Target model for tenants

Tenant end-users authenticate through **vc-common-service's `oidc-provider`**, which federates upstream to Keycloak for the actual login. Grafana is an OIDC client of vc-common-service — not of Keycloak directly. On login:

1. Grafana redirects to vc-common-service's `/oidc/auth` (authorization_code + PKCE).
2. vc-common-service has no session → federates upstream to Keycloak; the user authenticates there.
3. vc-common-service resolves the user → `tenant_id`, scopes, roles, and issues its **own** JWT access token (`tenant_id` claim, `logs:read` scope where granted, `aud = loki-gateway`).
4. A static `org_mapping` rule routes the user to the tenant org as `Viewer`.
5. On each dashboard query, Grafana forwards the app token (`oauthPassThru`) to the gateway; the gateway validates it against vc-common-service's JWKS, **checks the `logs:read` scope (fail closed)**, resolves `tenant_id → traction_tenant_id`, sets `X-Scope-OrgID: tenant_id|traction_tenant_id`; Loki returns only that tenant's vc-common-service + Traction streams.

This is the same token model the VC API consumers use — the gateway validates observability queries exactly the way the API's guard (AU-03) validates everything else.

### The security principle: Grafana roles are UX, the identity-scoped backend is the boundary

A foundational point that shapes the whole design: any authenticated Grafana user — Viewer included — can POST arbitrary queries directly to Grafana's datasource query API (`/api/ds/query`) using their session cookie, against any datasource in their org. Viewer role, dashboard permissions, and Explore visibility restrict the **UI**, not the query path. Therefore:

- Restricting tenants to Viewer role prevents accidental misuse, not attack
- "Disable Explore" is not a mitigation
- The enforcement chain must be: app token → gateway (identity → tenant scope) → Loki (`X-Scope-OrgID` isolation). Every element of that chain is outside the tenant's control.

Under this model a tenant can hand-craft any LogQL they like — through Explore, `/api/ds/query`, or curl — and Loki will only ever return streams belonging to their own tenant scope.

### Security boundary analysis

| Threat | Recommended architecture (identity gateway + Loki multi-tenant) | Shared datasource, label filtering only |
|--------|------------------------------------------------------------------|------------------------------------------|
| Tenant sees another tenant's data via dashboards | Prevented — scope derived from their own token | Not prevented (edit variable/query) |
| Tenant queries another tenant's raw logs (Explore or direct `/api/ds/query`) | **Prevented — gateway sets scope from the validated app JWT; Loki enforces** | **Not prevented** |
| Tenant spoofs `X-Scope-OrgID` | Prevented — gateway strips/sets the header itself; Loki is not directly reachable from Grafana users | n/a |
| Tenant replays another user's token | Standard OIDC threat — token validation, short lifetimes, TLS | n/a |
| Platform/admin sees all tenant data | By design (platform org datasource bypasses the tenant gateway or uses a pipe-joined admin scope) | By design |

**Network requirement**: Loki must only be reachable via the gateway(s) — NetworkPolicy so that nothing else in-cluster can hit Loki's query endpoints with an arbitrary `X-Scope-OrgID`. **Current state**: Loki's NetworkPolicy is **permissive in dev/test** (`namespaceSelector: {}` — any namespace can reach it); only prod has an explicit allow-list. "Reachable only via the gateway" therefore means dev/test need the **prod-style hardening** too. This has to land through **gitops** (manual cluster patches get reverted by CD), and mind the DNS egress port on OpenShift.

### The auth foundation is spec-only today

> **Load-bearing caveat**: none of the auth foundation this design leans on is built yet. `oidc-provider` is not a dependency in the codebase, and the guards in `libs/auth` are stubs that throw `NotImplementedException`. Interactive PKCE, Keycloak federation, JWT access tokens, client registration, and `logs:read` are all **spec-only**. The items below are **hard upstream dependencies**, not "open questions" — exactly what OB-07's blocker list already encodes. **Phase 2 depends on this foundation landing first.**

### vc-common-service oidc-provider integration specifics

- Grafana registers as an `authorization_code` (interactive, PKCE) client in `oidc-provider` (AU-01). Note: API client registration (AU-06) is oriented to `client_credentials` machine clients today — interactive-client support may need a small extension, or Grafana can be registered out-of-band.
- `oidc-provider` must federate the browser login upstream to Keycloak — AU-02 must cover the **interactive** flow, not just backend token exchange.
- Access tokens must be **JWTs carrying `tenant_id`** (`oidc-provider` issues opaque tokens by default; enable JWT access tokens). Alternatively the gateway introspects, but JWT is preferred for stateless validation.
- The gateway must **authorize on `logs:read`** (fail closed), not just authenticate — `logs:read` is a real minted scope, docs-only today; reconcile against the `OWNER/ADMIN/MEMBER/READONLY` role enum when seeded (AU-04).
- Scope the gateway audience via resource indicator (`aud = loki-gateway`).
- **Availability coupling**: vc-common-service is now in Grafana's login path — if it's down, tenants can't log into Grafana, but they also can't use the API, so the blast radius is already shared.

### Dependencies (was "open questions")

These are prerequisites the Phase-2 gateway depends on — tracked as blockers, not questions:

- [ ] `oidc-provider` (AU-01) built with interactive authorization_code + PKCE and upstream Keycloak federation (AU-02) for browser login.
- [ ] JWT access tokens enabled in `oidc-provider` (vs. opaque + introspection); `tenant_id` + `aud` claims present.
- [ ] `logs:read` scope seeded (AU-04) and enforced by the gateway (fail closed).
- [ ] API client registration (AU-06) covers interactive clients, or Grafana registered out-of-band.
- [ ] Loki NetworkPolicy hardened in dev/test (gitops) so query endpoints are reachable only via the gateway and platform paths.
- [ ] Security review for exposing observability data to external tenants.

---

## Tracing & Metrics (platform-internal)

Traces and metrics are **platform-internal for MVP** — tenants get logs and dashboards; traces are for us when assisting them. Tenant-facing scope is logs, deliberately.

### Tracing for MVP: vc-common-service ↔ Traction

OpenTelemetry propagates trace context via the W3C `traceparent` HTTP header, so the HTTP hops that matter for MVP join one trace with standard auto-instrumentation:

- **Our side** (vc-common-service, and its outbound HTTP to the Traction API): covered by OTel auto-instrumentation (OB-01), plus custom spans for credential operations (OB-02). `tenant.id` is set as a span attribute at the request boundary.
- **Into Traction**: ACA-Py is **not OTel-instrumented**, so the trace **breaks at the Traction boundary** — auto-instrumentation only covers our side. Cross-service trace continuity into Traction is itself **deferred work**, not something we get free from standard instrumentation.

DIDComm hops (Traction ↔ Mediator/Endorser) carry no `traceparent` and break the trace by default. That boundary is out of scope for MVP; when it matters, correlate at the edges by the Aries `thread_id` (already emitted in the protocol) rather than bridging Aries RFC 0034 into OTel. Cross-chain tracing across vc-authn-oidc / Endorser / Mediator is post-MVP.

### Tenancy model for traces and metrics

Keep traces single-tenant (platform), attribute-tagged:

- All spans go to one platform Tempo tenant; services set `tenant.id` (and where relevant `traction_tenant_id`, `thread_id`) as span attributes.
- Platform engineers filter with TraceQL: `{ span.tenant.id = "tenant-456" }`.
- Per-tenant trace *ingest routing* has no `stage.tenant` equivalent for OTLP and is materially harder than logs — not worth it for MVP. If tenant-facing traces are ever needed, the identity-aware gateway pattern extends to Tempo (same `X-Scope-OrgID` semantics).

The same applies to **metrics**: ACA-Py emits no per-tenant metrics (confirmed upstream), so there is nothing to route per-tenant. Keep metrics platform-internal (OB-04).

### Open questions

- [ ] Confirm which OTel components the in-flight instrumentation rollout standardizes on (SDK versions, Alloy `otelcol.*` pipeline).
- [ ] Tempo version — confirm `multitenancy_enabled` and TraceQL attribute filtering (expected yes on any recent version).
- [ ] Sampling strategy: 100% for low-volume VC flows initially, or head sampling from the start?

---

## Recommended Architecture

Bringing the categories together:

```text
WRITE PATH (ingestion) — two paths converge on Loki
───────────────────────────────────────────────────
 vc-common-service ──HTTP (sub-wallet bearer token)──▶ Traction / ACA-Py
   structured logs (tenant_id)                          agent logs (traction_tenant_id *)
        │                                                     │
        └──────────────┬──────────────────────────────────────┘
                       ▼
             Alloy (per-namespace loki.process)          BC Wallet apps
             stage.json → stage.tenant                   (external, direct push)
             line → Loki tenant = tenant_id /                  │ curl + basic auth
                    traction_tenant_id                         ▼
             unattributed → platform tenant            nginx gateway (basic auth)
                       │                                proxy_set_header
                       │                                X-Scope-OrgID $remote_user
                       └──────────────┬───────────────────────┘
                                      ▼
                     Loki (auth_enabled: true)
                     global limits_config (enforced per-tenant)
                       + per-tenant overrides (e.g. bcwallet headroom)
                     reachable ONLY via gateways (NetworkPolicy — target state)
                                      ▲
READ PATH (query)                     │ X-Scope-OrgID: <tenant_id>|<traction_tenant_id>
─────────────────                     │ (multi_tenant_queries_enabled)
                     identity-aware gateway
                     validate app JWT (JWKS) + require logs:read scope
                     → tenant_id → ConnectorCredential → traction_tenant_id
                     set X-Scope-OrgID; strip Authorization; no query parsing
                                      ▲
                     Dedicated tenant Grafana (separate instance)
                     default org · oauthPassThru datasource · generic dashboards
                     stateless pods + own Postgres · provisioned-only
                                      ▲
                     vc-common-service oidc-provider ──federates──▶ Keycloak
                     (Grafana = OIDC client; single provider on this instance)

 * Traction emits traction_tenant_id only after ACAPY_LOG_CONFIG is set to log JSON — prerequisite.
 NOTE: oidc-provider, JWT issuance/validation, guards, the ConnectorCredential mapping, and
       logs:read are all spec-only today; this Phase-2 flow depends on that foundation landing first.
```

1. **Ingestion — two paths.** (a) In-cluster: services + Traction → Alloy → `stage.json` → `stage.tenant` routes each line to a Loki tenant (`tenant_id` / `traction_tenant_id`). This is net-new pipeline work — today Alloy only runs `static_labels` + `label_keep`. (b) External direct push (BC Wallet): `curl` + basic auth → nginx gateway injects `X-Scope-OrgID` from `$remote_user`. **Prerequisite**: Traction must be configured (`ACAPY_LOG_CONFIG`) to emit its sub-tenant id as JSON. Loki runs `auth_enabled: true`; unattributed lines → platform tenant.
2. **Identity mapping — `tenant_id → traction_tenant_id`.** Reuses the existing per-tenant `ConnectorCredential` record (PE-06); no new entity. Consumed by the read gateway (cached). `ConnectorCredential` is planned P0 (not yet coded); `traction_tenant_id` should be a queryable column on it.
3. **Loki isolation + limits.** `auth_enabled: true` enforces per-tenant. A global `limits_config` (query length/series/rate/cardinality) is required before external exposure — one global config, enforced per-tenant automatically; per-tenant overrides only for exceptions (e.g. `bcwallet` ingest headroom). Loki reachable only via the gateways (NetworkPolicy — dev/test permissive today, hardening required).
4. **Access layer, zero per-tenant Grafana resources.** A dedicated tenant-facing Grafana (own instance, single default org, one `oauthPassThru` datasource, one generic dashboard set, stateless pods + own Postgres, provisioned-only). The read gateway turns the validated app JWT (+ `logs:read` authz) into `X-Scope-OrgID`; Loki enforces. Tenants may use dashboards / Explore / raw API — only ever their own data.
5. **Per-tenant onboarding — one existing record.** The binding is the app-issued `tenant_id` claim. Gated on the (currently unbuilt) `oidc-provider` foundation that mints and validates those tokens.
6. **Traces & metrics — platform-internal, tagged `tenant.id`.** Traction is uninstrumented, so the trace stops at its boundary; per-tenant traces are deferred.
7. **Migration — none for platform data** (existing `"fake"` stays queryable). **Not zero** for external push consumers: the `auth_enabled` flip breaks BC Wallet's push unless the nginx gateway injects their `X-Scope-OrgID` first — a coordinated, dev-verified cutover before prod.

**Two custom gateways** (both security-critical, fail closed, Loki network-isolated behind them):

- **Write-path nginx** — basic-auth → `X-Scope-OrgID` injection for external direct-push consumers.
- **Read-path identity-aware gateway** — app-JWT validation + `logs:read` authorization + header mapping, no query parsing.

### Decision: Grafana (this design) over an in-app console

An alternative was considered: since vc-common-service is greenfield and owns tenant identity and auth, it could query Loki server-side (setting `X-Scope-OrgID` from the tenant's `ConnectorCredential`) and render log views in its own tenant console — this is what requirements **OB-07** (Loki-backed log query service) + **UI-08** (terminal console) originally described.

**Decision: use Grafana** (this design), superseding OB-07 + UI-08. Both options share the same foundation (Loki multi-tenancy + the `ConnectorCredential` mapping + Alloy extraction) and the same identity-to-scope logic; the difference is only whether the UI is Grafana dashboards or in-app console views. Grafana was chosen for out-of-the-box dashboards, ad-hoc exploration, and parity with the platform's own tooling. An in-app console (e.g. embedding Grafana panels via `allow_embedding`) remains a future option with no wasted foundation work.

### Phased plan

```text
PoC (now)           → Get Traction emitting JSON with its sub-tenant id (ACAPY_LOG_CONFIG) —
                      load-bearing check. Alloy stage.json + stage.tenant for Traction logs;
                      enable Loki auth_enabled: true in dev + a global limits_config; wire the
                      nginx write-path X-Scope-OrgID injection for the BC Wallet push tenant;
                      validate isolation end-to-end (curl Loki through a stub gateway with
                      different tenant scopes; confirm BC Wallet push still returns 204).

Phase 2 (near-term) → DEPENDS ON the auth foundation landing (oidc-provider, JWT access tokens,
                      guards, logs:read). Then: identity-aware read gateway (validate app JWT +
                      logs:read authz, resolve tenant_id → traction_tenant_id from
                      ConnectorCredential, set X-Scope-OrgID); dedicated tenant Grafana instance
                      (OIDC client of vc-common-service) + datasource + generic dashboards;
                      Loki NetworkPolicy hardening (dev/test).

Phase 3 (parallel)  → OTel auto-instrumentation for vc-common-service (our side only; ACA-Py is
                      uninstrumented) as part of the in-flight OTel rollout; tenant.id span
                      attributes; platform-internal Tempo + TraceQL for tenant support.
```

---

## Feasibility Summary

### Low effort / low risk

| Capability | Effort | Risk | Notes |
|-----------|--------|------|-------|
| Alloy `stage.tenant` routing for Traction logs | Low–Medium | Medium | Net-new pipeline (today `static_labels` + `label_keep` only); **gated on Traction emitting JSON** (`ACAPY_LOG_CONFIG`) |
| Loki `auth_enabled: true` | Medium | Medium | Coordinated cutover — breaks BC Wallet direct push unless nginx injects `X-Scope-OrgID` first |
| Generic shared dashboards | Low | Low | One set for all tenants; scoping comes from identity |
| Dedicated tenant Grafana instance + static `org_mapping` | Low–Medium | Low | Separate instance (single `generic_oauth` on platform Grafana); one-time setup |

### Medium effort

| Capability | Effort | Risk | Notes |
|-----------|--------|------|-------|
| Identity-aware read gateway | Medium | Medium | Security-critical but narrow (app JWT + `logs:read` authz → header); needs review + NetworkPolicy isolation of Loki |
| nginx write-path `X-Scope-OrgID` injection (external push) | Low–Medium | Medium | For BC Wallet direct push; anti-spoof via `proxy_set_header` |
| Global Loki `limits_config` (+ `bcwallet` override) | Low–Medium | Medium | Required before exposing arbitrary LogQL to external tenants |
| Traction JSON log-config (`ACAPY_LOG_CONFIG`) | Medium | Medium | Gitops in the Traction repo; blocks `stage.json` |
| Grafana as OIDC client of vc-common-service | Medium | Low | Register interactive client; JWT access tokens with `tenant_id` + `aud` |
| oidc-provider interactive flow + JWT access tokens | Medium | Low | **Spec-only today**; AU-01/AU-02 must cover browser authorization_code + upstream Keycloak federation |
| OTel auto-instrumentation (our side only) | Medium | Low | No upstream code changes; ACA-Py stays uninstrumented |

### High effort / deferred

| Capability | Effort | Risk | Notes |
|-----------|--------|------|-------|
| Cross-service trace continuity into Traction | High | Medium | ACA-Py not OTel-instrumented; deferred, not free from standard instrumentation |
| DIDComm-boundary trace continuity (RFC 0034 bridge) | High | Medium | Deferred; correlate via thread_id attributes instead |
| Cross-service correlation (vc-authn / Endorser / Mediator) | High | Medium | Post-MVP; needs dynamic multi-identifier registry + DIDComm work |
| Per-tenant metrics | High | Medium | No per-tenant metrics exist upstream; revisit with OTel maturity |
| Tenant-facing traces (per-tenant Tempo ingest routing) | High | Medium | No stage.tenant equivalent for OTLP; platform-internal traces instead |
| Per-tenant Grafana orgs/datasources | — | — | **Rejected**: does not scale to hundreds/thousands of tenants |

---

## Open Questions Master List

> Collected from all categories above. Triage and assign before implementation begins.

**Identity & Data**
- [ ] Confirm the Traction log field/format once `ACAPY_LOG_CONFIG` is enabled (sub-tenant as `tenant_id` vs `wallet_id`). **(Blocks everything — verify first.)**
- [ ] Add `traction_tenant_id` as a queryable column on `ConnectorCredential` (PE-06); reconcile the "ConnectorCredential doesn't exist yet" gap in code.
- [ ] Confirm the app-issued token claim name for the tenant key aligns with the API's `tenant_id` claim (AU-03/AU-05).

**Loki / Alloy**
- [ ] Confirm the Alloy version supports `stage.tenant` (v1.15.0; expected yes)
- [ ] Define the global `limits_config` + `bcwallet` per-tenant override before exposure
- [ ] Coordinate the `auth_enabled: true` cutover with the nginx write-path injection (BC Wallet push must keep returning 204)
- [ ] Default tenant name for unattributed lines
- [ ] Object-storage overhead for many low-volume tenants

**Access layer / Auth (hard dependencies — foundation is spec-only)**
- [ ] `oidc-provider` (AU-01) built: interactive authorization_code + PKCE with upstream Keycloak federation (AU-02)
- [ ] JWT access tokens with `tenant_id` + `aud = loki-gateway` (vs. opaque + introspection)
- [ ] `logs:read` scope seeded (AU-04) and enforced by the gateway (fail closed); reconcile role-enum naming
- [ ] API client registration (AU-06) covers interactive clients, or Grafana registered out-of-band
- [ ] `oauthPassThru` + app-token refresh validated on the dedicated tenant Grafana instance
- [ ] Gateway `ConnectorCredential` lookup path (DB vs. internal API), cache TTL/invalidation
- [ ] Gateway placement: replace vs chain with the existing nginx basic-auth gateway
- [ ] `allow_embedding = true` + CSP `frame-ancestors` on the tenant Grafana instance (for UI-08)
- [ ] Loki NetworkPolicy hardened in dev/test (gitops) so Loki is reachable only via the gateways

**Tracing & Metrics (platform-internal)**
- [ ] OTel components/versions standardized by the in-flight rollout
- [ ] Tempo version + `multitenancy_enabled` availability
- [ ] Sampling strategy

**Security**
- [ ] Security review process for exposing observability data to external tenants

---

## References

- [Loki Multi-Tenancy](https://grafana.com/docs/loki/latest/operations/multi-tenancy/)
- [Alloy `loki.process` — `stage.tenant`](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/)
- [Grafana data source settings — Forward OAuth Identity](https://grafana.com/docs/grafana/latest/administration/data-source-management/)
- [Grafana Generic OAuth Configuration](https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/generic-oauth/)
- [Grafana OSS Organization Management](https://grafana.com/docs/grafana/latest/administration/organization-management/)
- [Tempo Multi-Tenancy](https://grafana.com/docs/tempo/latest/operations/manage-advanced-systems/multitenancy/)
- [Tempo Cross-Tenant Query Federation](https://grafana.com/docs/tempo/latest/operations/manage-advanced-systems/cross_tenant_query/)
- [Aries RFC 0034: Message Tracing](https://identity.foundation/aries-rfcs/latest/features/0034-message-tracing/)
- Our Grafana config: [infra/monitoring/grafana/values.yaml](../infra/monitoring/grafana/values.yaml)
- Our Loki config: [infra/monitoring/loki/chart/values.yaml](../infra/monitoring/loki/chart/values.yaml)
- Our Alloy config: [infra/monitoring/alloy/values.yaml](../infra/monitoring/alloy/values.yaml)
- Loki architecture doc: [observability/loki-architecture.md](../observability/loki-architecture.md)
- Grafana/Alloy architecture doc: [observability/grafana-alloy-architecture.md](../observability/grafana-alloy-architecture.md)
