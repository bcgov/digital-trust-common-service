# Tenant Log Access and Isolation Contract

**Status**: Normative. This document defines the contract; it does not implement it.

This is the authoritative specification for how a tenant reads its own logs through the
dedicated tenant-facing Grafana. Every component in the chain — the identity-aware gateway,
the tenant Grafana instance, Loki, Alloy, the agent log configuration, and the write-path
nginx — implements against this document. Where this document and
[tenant-observability-design.md](./tenant-observability-design.md) disagree, this document
wins: that one is a dated research spike, this one is the contract.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used as
defined in RFC 2119.

---

## 1. Purpose and scope

### 1.1 What this contract covers

A tenant of this service must be able to read the log lines produced on its behalf — both by
this service and by the credential agent acting for it — without being able to read any other
tenant's lines, and without the platform team brokering the request.

This contract defines:

- the token a caller presents, the claims it carries, and the authorization it must prove;
- the resource audience that separates a log-reading token from an API token;
- how this service's tenant identity is mapped to the identifier the agent stamps on its own
  log lines, expressed as a constraint rather than a storage shape;
- the storage-layer tenancy model and the header contract that drives it;
- the rule that tenant selection is never an input;
- the tests that demonstrate the boundary holds;
- which work is owned outside this repository and what "done" means for each owner.

### 1.2 What this contract does not cover

It is not an implementation. It specifies no gateway internals, no Grafana configuration, no
Loki or Alloy values, no agent deployment change, and no nginx configuration. Those live in
the repositories identified in [section 8](#8-external-ownership), and each is accepted
against the criteria in [section 9](#9-acceptance-and-closure).

It also does not cover the write path beyond the requirements that make the read path safe.
How a line is produced and shipped is an ingestion concern; this contract only requires that
by the time a line is queryable it is already partitioned correctly.

### 1.3 Logs only — metrics and traces are excluded

The tenant-facing observability surface is **logs, and only logs**. Metrics and traces remain
platform-admin-only and are outside this contract. This is a deliberate design consequence,
not an oversight or a phasing decision:

- **Metrics carry no tenant label by construction.** Metric series must not carry `tenant_id`
  or any other unbounded label, because per-tenant series would make cardinality grow with
  tenant count. There is consequently nothing in the metric store to partition on, and adding
  the label to enable tenant access would reintroduce the cardinality problem the current
  design exists to avoid.
- **Traces have no per-line routing equivalent.** Log lines can be routed to a storage tenant
  individually at the collector. Trace ingestion has no equivalent per-span routing hook, so
  per-tenant trace partitioning is materially harder than the logs case and buys little: the
  agent is not trace-instrumented, so a tenant-visible trace would stop at our own boundary.
- **Traces and metrics are diagnostic tooling for the operator**, carrying cross-tenant
  aggregates and internal topology that a tenant has no basis to see.

Tenant identity is still recorded on spans as a span attribute so an operator can filter to one
tenant when assisting them. That is an operator affordance and confers no tenant access.

Any future proposal to expose metrics or traces to tenants is a new contract, not an extension
of this one.

### 1.4 Relationship to the tenant audit log

The tenant audit log is a separate, already-specified API surface with its own scope. It
answers "what did my organization do", is a durable record, and is served by this service.
Tenant log access answers "what happened when my request ran", is operational telemetry, and
is served by Loki. They are independent grants: neither scope implies the other, and nothing in
this contract changes audit-log behaviour.

---

## 2. What "tenant" means in each service

Four different systems in this chain each use the word "tenant" for a different thing, and
two of them use more than one identifier for the same subject. Nearly every isolation mistake
available in this design starts by treating two of the rows below as interchangeable.

This contract therefore does not use the bare word "tenant". It uses the terms defined here.

| Term | System | What it identifies | Identifier | Where it appears in logs | Owner |
|---|---|---|---|---|---|
| **Service tenant** | This service | A customer organization — the subject of our tenancy model and the unit of isolation everywhere in our own data | `tenant_id`, a UUID we generate | Emitted as a structured `tenant_id` field on our own log lines | Us. Authoritative. |
| **Agent sub-tenant** | Credential agent (Traction/ACA-Py today) | One sub-wallet on a shared multi-tenant agent, acting for exactly one service tenant | **Two distinct identifiers — see below** | The agent stamps its own log records | The agent |
| **Loki tenant** | Loki | A storage partition. An opaque key; Loki attaches no meaning to it and enforces isolation between partitions | Whatever string we put in the routing header | n/a — it is the partition, not a field | Us, by choice of value |
| **Grafana org** | Grafana | A UI grouping of users, dashboards and datasources | Numeric org id | n/a | Platform |

### 2.1 The agent sub-tenant has two identifiers, and they are not interchangeable

This is the single most important distinction in this contract, and the one that has already
caused confusion.

| Identifier | What it is for | Where we get it | Appears on agent log lines? |
|---|---|---|---|
| **Agent API sub-tenant id** | Addressing the agent's API — the identifier under which we request a bearer token for this sub-wallet | Supplied when the connector is configured, held with the connector's other credential material | **No** |
| **Agent log identifier** (the wallet id, for the current agent) | Correlating log lines to a sub-wallet — the value the agent stamps on each of its own log records | Present in the bearer token the connector already obtains from the agent | **Yes** |

Both identify the same sub-wallet. Only the second one appears in logs, so only the second one
can be used to partition or query them. Using the API sub-tenant id as a log partition key
produces a partition that is either empty or, worse, populated by a coincidental match.

A future agent implementation will have its own pair of identifiers with its own names. The
contract is written against the **roles** — "the identifier the agent's API is addressed by"
and "the identifier the agent stamps on its log lines" — never against the names a particular
agent happens to use today.

### 2.2 Grafana orgs are not an isolation boundary here

All tenant users share a single org on the tenant-facing Grafana instance. This is
intentional: per-tenant orgs, datasources and dashboard copies do not scale to the tenant
counts this service is designed for, and they are not what enforces isolation.

Consequently, any authenticated user of that instance can issue arbitrary queries against its
datasource — through Explore, through the datasource query API, or with a plain HTTP client.
Grafana's Viewer role, dashboard permissions, and Explore visibility restrict the **UI**, not
the query path. They are usability features and **MUST NOT** be described or relied upon as
security controls.

The boundary is the token, the gateway, and the storage-layer partition — every element of
which is outside the caller's control.

### 2.3 Upstream identity is not tenant identity

Users authenticate upstream, but the upstream identity provider has no concept of a service
tenant and **MUST NOT** be given one for this purpose. No upstream group, role, or claim
participates in tenant scoping. Upstream establishes *who the human is*; this service resolves
*which service tenant they act for* and asserts it in the token it issues. That keeps a single
authority over tenant identity and removes any need for upstream group or claim-mapping work.

---

## 3. The token contract

### 3.1 Shape and validation

**Rule T1.** The caller presents an access token **issued by this service**, signed RS256, and
validated against this service's JWKS. The gateway **MUST** verify the signature, the issuer,
the expiry, and the audience before anything else, and **MUST** fail closed on any failure.
This is deliberately the same validation the API's own JWT guard performs, so a token is
either valid to both validators on its own terms or valid to neither.

**Rule T2.** The gateway **MUST NOT** accept any other credential as a substitute: not an
upstream token, not an agent token, not a shared secret, not a basic-auth identity, and not a
session cookie.

### 3.2 Claims

The token carries the claims this service already mints. The ones this contract depends on:

| Claim | Required | Role in this contract |
|---|---|---|
| `tenant_id` | Yes | The service tenant the caller acts for. **The sole source of tenant identity.** |
| `scope` | Yes | Space-delimited granted scopes. Carries the log-read authorization. |
| `aud` | Yes | The resource this token was minted for. See [3.4](#34-audience-separation). |
| `iss` | Yes | This service's OIDC issuer. |
| `exp`, `iat` | Yes | Validity window. |
| `sub` | Yes | The authenticated subject. For attribution and support only. |
| `client_id` | For machine clients | For attribution and support only. |
| `roles` | Yes | See [3.5](#35-platform-admin-is-not-a-bypass) — carries **no** tenant-scoping meaning here. |

**Rule T3.** Tenant identity **MUST** be taken from the `tenant_id` claim of the validated
token and from nowhere else. A token with no `tenant_id`, an empty `tenant_id`, or more than
one `tenant_id` value **MUST** be rejected. There is no fallback, no default, and no
"unscoped" mode.

**Rule T4.** A token **MUST** authorize exactly one service tenant. Multi-tenant tokens are
outside this contract; if a legitimate need for one appears, it is a new contract with its own
threat model, not a change to this claim's cardinality.

### 3.3 Authorization

**Rule T5.** The gateway **MUST** require the tenant log-read scope (`logs:read`) and **MUST**
fail closed when it is absent. Authenticating the caller is not sufficient — a valid token
without this scope is a `403`, and no query is forwarded.

**Rule T6.** The scope check **MUST** apply the same expansion the API applies, not a literal
string membership test. The tenant superuser scope (`tenants:admin`) implicitly grants every
Level 2 and Level 3 scope, including log read. A gateway that tests for the literal string
only would deny a tenant owner whose token legitimately carries the superuser scope alone.
This is a correctness requirement, not a permissiveness one: the expansion rule is the one
already implemented for the API, and the gateway must not invent a second, divergent
interpretation of the same scope set.

**Rule T7.** Authorization **MUST** be evaluated per request, from the presented token. The
gateway **MUST NOT** cache an authorization decision across tokens or subjects.

### 3.4 Audience separation

**Rule T8.** A token used for log queries **MUST** carry the log gateway's resource audience,
requested as an RFC 8707 resource indicator and configured as an accepted additional audience.
It **MUST NOT** carry the API audience.

**Rule T9.** The gateway **MUST** reject a token whose `aud` is the API audience, even when
that token is otherwise valid and carries the log-read scope. The converse already holds: the
API's guard accepts only the API audience, so a gateway-audience token cannot be replayed
against the API.

This gives a two-way, structural separation. A token minted for Grafana to forward is useless
against the API, and an API token — which is far more widely distributed, including to machine
clients — is useless for reading logs. Because a token resolves to a single resource audience,
this separation cannot be defeated by requesting both at once.

**Rule T10.** The gateway's audience value **MUST** be configured explicitly and **MUST NOT**
be derived from the request — not from the `Host` header, not from a forwarded proto or host
header, and not from the request URL. Deriving the expected audience from attacker-influenced
input would make the audience check self-satisfying.

### 3.5 Platform admin is not a bypass

**Rule T11.** The gateway **MUST NOT** implement a role-based bypass of tenant scoping. In
particular, the platform-admin role — which does bypass scope and tenant guards on the API —
confers **no** cross-tenant read through this path. A token carrying it is scoped to its own
`tenant_id` exactly like any other.

Operator access to all logs is a separate path with its own authentication, reached through
the platform Grafana, and is never served by widening a tenant-facing component. Keeping the
bypass out of the tenant gateway means the tenant path has no cross-tenant code to reach at
all, rather than merely having it guarded.

---

## 4. Mapping a service tenant to its agent log identifier

To show a service tenant both its own lines and the lines its agent produced on its behalf,
the gateway must resolve the service tenant to that tenant's **agent log identifier**
([2.1](#21-the-agent-sub-tenant-has-two-identifiers-and-they-are-not-interchangeable)).

This section specifies that resolution as a **constraint on where the answer may come from and
how it must behave**. It deliberately does not name a column, a table, a cache, or a service
boundary. Those are implementation choices, and the contract is satisfied by any
implementation that holds the constraints below.

### 4.1 Provenance

**Rule M1.** The identifier **MUST** be resolved from the **requesting service tenant's own
connector record**, reached by that tenant's `tenant_id`. Each tenant's connector already
carries its own agent identity; the identifier rides with it.

**Rule M2.** Resolution **MUST NOT** scan, join, or search across connector records belonging
to other service tenants, and **MUST NOT** consult any global index, registry, or reverse
lookup keyed by the agent identifier. The query is "what is this tenant's identifier", never
"whose identifier is this". A reverse lookup would make a mistake in the mapping a
cross-tenant read; a forward lookup from the tenant's own record makes the same mistake an
empty result.

**Rule M3.** No new schema is introduced for this. The connector's credential material is
already a per-connector-type set of values held together; the agent log identifier is another
value in that set. There is **no** dedicated column, **no** separate mapping table, and **no**
new registry entity.

**Rule M4.** The identifier is **not** a secret — it is an identifier, and it is emitted in
plaintext on every agent log line. It is stored where the connector's other material is stored
because that is where per-connector values belong and where the rotation lifecycle already
exists, not because it requires protection. This contract places no confidentiality
requirement on it and does not weaken the protection of anything stored alongside it.

### 4.2 Agent-agnostic by construction

**Rule M5.** Resolution **MUST** be expressed in terms of the connector's type, not hardcoded
to the agent deployed today. Each connector type supplies its own log identifier under its own
name. A future agent must be supportable by teaching its connector type where its identifier
lives — not by a schema migration, and not by a change to this contract.

**Rule M6.** The gateway **MUST NOT** interpret the identifier's format. It is an opaque
string used as a partition key. No parsing, no validation beyond non-emptiness, no assumption
that it is a UUID, and no assumption that it resembles any other identifier we hold.

### 4.3 Freshness

**Rule M7.** The resolved identifier **MUST** be refreshed when the tenant's connector
credentials are rotated or replaced. A connector may be re-provisioned against a new
sub-wallet, in which case the old identifier is simply wrong.

**Rule M8.** Any cache **MUST** be bounded in both size and age, **MUST** be keyed by the
service tenant, and **MUST** be invalidated on connector credential change. A cache **MUST
NOT** be keyed by, or allow retrieval by, the agent log identifier — that would be the reverse
lookup Rule M2 prohibits, reintroduced at the cache layer.

**Rule M9.** A cache **MUST NOT** serve a stale entry as a fallback when a fresh resolution
fails. Failing closed on a resolution error is required; serving the last known identifier is
not an acceptable degradation, because the reason resolution failed may be exactly that the
mapping changed.

### 4.4 Failure behaviour — fail closed, and distinguish "none" from "unknown"

**Rule M10.** Resolution **MUST** fail closed. Every case below denies access to agent logs. No
case widens the scope, falls back to a default, or omits the partition constraint.

| Case | Meaning | Behaviour |
|---|---|---|
| Tenant has no connector configured | The tenant has not been onboarded to an agent | Serve **this service's** lines for that tenant only. Not an error — a tenant with no agent legitimately has no agent logs. |
| Connector exists but carries no log identifier | Configured before the identifier was captured, or the agent did not supply one | Serve this service's lines only. Surface as an operator-visible condition — it is a resolvable configuration gap, and silently degrading hides it. |
| Connector is inactive | Deactivated, or the tenant is deactivated | Treat as no connector. **MUST NOT** resolve an identifier from an inactive connector. |
| **Ambiguous — more than one candidate identifier** | The tenant has multiple active connectors of the same type, so "the tenant's agent identifier" has no single answer | **Deny the whole request.** See Rule M11. |
| Resolution errors | Datastore unavailable, decryption failure, unexpected shape | **Deny the whole request** with a server error. **MUST NOT** degrade to this service's lines only — a failure of the isolation machinery is not a partial-results condition. |

**Rule M11.** Ambiguity **MUST** deny the entire request rather than pick a candidate, and
**MUST NOT** be resolved by any implicit tie-break — not most-recently-created, not
lowest-id, not first-returned. Multiple active connectors of one type for one tenant is
already representable, so this is a reachable state and not a theoretical one. An arbitrary
tie-break would silently bind a tenant's log view to whichever connector happened to sort
first, which is a wrong answer delivered confidently. Denying makes the misconfiguration
visible and keeps the failure inside the tenant's own boundary.

**Rule M12.** Failure responses **MUST NOT** disclose whether another service tenant exists,
how many connectors a tenant has, or any identifier belonging to another tenant. The
distinctions above are for the operator, through logs and metrics, not for the caller.

---

## 5. Storage-layer tenancy

### 5.1 Isolation lives in the storage layer

**Rule L1.** Log isolation **MUST** be enforced by Loki's native multi-tenancy
(`auth_enabled: true`), which partitions data by the `X-Scope-OrgID` request header and makes
a query against one partition structurally incapable of returning another partition's data.

The alternatives were considered and are **rejected as boundaries**:

| Approach | Status | Why |
|---|---|---|
| Native multi-tenancy | **Required** | Enforced below the query layer. A caller with arbitrary query control still cannot cross a partition. |
| Label-based filtering on a shared partition | **Rejected** | Open-source Loki has no query-level label enforcement. Any caller who can send a query can send one without the label. This is a display convention, not a control. |
| A proxy that parses LogQL and injects a mandatory label matcher | **Rejected** | Puts a query parser in the security path. Every parser gap, every new LogQL feature, and every operator precedence subtlety becomes an isolation bug. Native tenancy already provides the guarantee without parsing anything. |

**Rule L2.** No component in this design may rely on the **shape of a query** for isolation.
This is what makes it safe to give tenants arbitrary LogQL, Explore, and direct API access:
correctness does not depend on what they send.

### 5.2 Partitioning happens at ingestion

**Rule L3.** Each log line **MUST** be assigned its storage partition at ingestion by the
collector, from an identifier **already present on the line**. Partition assignment is
therefore a property of the data, fixed before any query exists, and not something the read
path can influence.

**Rule L4.** A line with no extractable identifier **MUST** be routed to the platform
partition. It **MUST NOT** be routed to a tenant partition, and **MUST NOT** be routed to a
shared partition that any tenant can read. Unattributed is not the same as public: the safe
default is operator-only.

**Rule L5.** The agent **MUST** emit structured logs carrying its log identifier as a discrete
field before its lines are routed to tenant partitions. Extracting the identifier by pattern
matching against unstructured text is **prohibited**: it makes every upstream log-format
change a potential mis-partitioning, which is to say a potential cross-tenant disclosure, with
no signal that anything broke. Until the agent emits structured logs, its lines stay in the
platform partition and tenants see only this service's lines.

**Rule L6.** Partition values **MUST** be the identifiers themselves — this service's
`tenant_id` for our lines, the agent log identifier for the agent's. This keeps the collector
configuration static: onboarding a tenant requires no collector change, no reload, and no
per-tenant configuration anywhere in the pipeline.

### 5.3 Preconditions for exposing query access

**Rule L7.** A global query limits configuration (query length, series, rate, cardinality)
**MUST** be in place before any tenant is granted query access. Arbitrary LogQL from external
callers without limits is a denial-of-service surface against every other tenant sharing the
backend. The limits are global and enforced per partition; per-partition overrides are for
known exceptions only.

**Rule L8.** Loki **MUST NOT** be reachable except through a gateway that sets the partition
header, in **every** environment — including development and test. An environment where the
storage backend accepts a caller-supplied partition header from anywhere in the cluster has no
boundary at all, and it is where the isolation tests would otherwise be validated against a
configuration that does not match production.

---

## 6. The gateway header contract

The gateway's entire job is to turn a validated identity into a partition scope. It is
security-critical and deliberately narrow.

### 6.1 The header is computed, never conveyed

**Rule G1.** The gateway **MUST** set the `X-Scope-OrgID` header itself, computed solely from
the validated token's `tenant_id` ([Rule T3](#32-claims)) and the mapping resolved under
[section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier). No other input
contributes to its value.

**Rule G2.** The gateway **MUST** unconditionally overwrite any inbound `X-Scope-OrgID`,
regardless of its value, and **MUST NOT** append to, merge with, or take any part of it. A
caller-supplied value is never echoed and never contributes — it is replaced before the
request is forwarded. This must hold on rejected requests too: nothing reaches the storage
backend carrying a caller-influenced partition header under any outcome.

**Rule G3.** The scope **MUST** be exactly the requesting service tenant's own partitions: this
service's partition for that tenant, and — where the mapping resolved — that tenant's agent
partition, combined as a multi-partition scope. Cross-partition querying must be enabled in
the backend for this to work. The scope **MUST NOT** include a platform partition, a default
partition, a wildcard, or any partition belonging to another service tenant.

**Rule G4.** The gateway **MUST** strip the caller's `Authorization` header before forwarding.
The storage backend has no use for the token, and forwarding it widens where a valid log token
can be observed.

### 6.2 The gateway does not read the query

**Rule G5.** The gateway **MUST NOT** parse, rewrite, validate, or inject into the query. It
does not need to: the partition scope it sets is what constrains the result, and it constrains
it identically no matter what the query says. Query parsing in the gateway is prohibited
rather than merely unnecessary — adding it would create a second, weaker enforcement path
whose gaps are not visible in the strong one.

### 6.3 Complete coverage of the read surface

**Rule G6.** The gateway **MUST** apply this contract to **every** route it exposes, not only
the obvious query endpoints. Label, series, label-values, index, and stats endpoints all return
data derived from log content and leak cross-tenant information — label values alone can
enumerate tenants, hosts, and operations. Live-tail endpoints matter particularly because they
are protocol upgrades: an implementation that injects headers on ordinary proxied requests can
silently skip the upgrade path.

**Rule G7.** Route handling **MUST** be an allowlist. Any path not explicitly enumerated and
covered is denied, so a backend version that adds a new read endpoint does not expose it by
default. A denylist fails open on exactly the routes nobody has thought about yet.

**Rule G8.** No read path to the storage backend that bypasses the gateway may be reachable by
a tenant user, in any environment. The write path is a separate concern with its own
authentication, and it **MUST NOT** be usable to read.

---

## 7. Tenant selection is never an input

This section is the negative space of the whole contract, stated once and explicitly, because
every mechanism below is a natural thing for an implementer to add and each one would silently
convert the boundary into a suggestion.

**Rule S1.** The partition scope **MUST** be derived solely from the validated token and the
mapping. It **MUST NOT** be influenced, in whole or in part, by any of:

| Mechanism | Why it is prohibited |
|---|---|
| Query or URL parameters (`?tenant=`, `?org_id=`) | Directly caller-controlled. |
| Path segments — per-tenant datasource or gateway URLs | Turns a URL guess into a cross-tenant read, and the URL is visible to the caller. |
| Inbound request headers, including `X-Scope-OrgID` | Trivially forged by any HTTP client. Covered by [Rule G2](#61-the-header-is-computed-never-conveyed). |
| Grafana datasource configuration — a tenant id in a custom header, URL, or secure field | Moves tenant identity into per-tenant configuration, which neither scales nor survives a misprovisioned datasource. |
| Dashboard template variables | Caller-editable, and equally editable outside dashboards. |
| Request body fields | Same as parameters, less visible. |
| Cookies or session state | Not validated by the gateway and not bound to the token. |
| Anything parsed out of the LogQL itself | Requires the query parsing [Rule G5](#62-the-gateway-does-not-read-the-query) prohibits. |
| Upstream identity provider groups, roles, or claims | Tenant identity has exactly one authority ([2.3](#23-upstream-identity-is-not-tenant-identity)). |

**Rule S2.** The tenant-facing Grafana **MUST** use a **single shared datasource** for all
tenant users, with no tenant identity in its URL, headers, or configuration. Per-tenant
datasources are prohibited — they are the same information expressed as configuration, where
it is harder to audit and can drift from the tenant it claims to serve.

**Rule S3.** Tenant-facing dashboards **MUST** be generic and identical for every tenant. They
**MUST NOT** embed a tenant identifier or offer a tenant selector variable. The same dashboard
shows each tenant their own data because the *identity* differs, not because the *dashboard*
differs.

**Rule S4.** A request attempting any prohibited selection **MUST** be served as though the
attempt were absent — scoped to the caller's own tenant — rather than rejected with an error
that confirms the mechanism exists. The attempt **MUST** be recorded for the operator. Silent
neutralisation plus operator-side visibility gives the caller no signal to probe against while
still surfacing the attempt to us.

### 7.1 Threat model

Each row is an attacker with a **valid token for tenant A** attempting to read tenant B, which
is the realistic adversary: a legitimate tenant user, authenticated, with full control of
their own HTTP client.

| # | Attack | Control | Outcome |
|---|---|---|---|
| 1 | Edit a dashboard query or variable to name tenant B | Scope comes from the token; the query is not consulted ([G5](#62-the-gateway-does-not-read-the-query)) | Tenant A's data |
| 2 | Bypass the UI — Explore, the datasource query API, or curl | Same control; the UI was never the boundary ([2.2](#22-grafana-orgs-are-not-an-isolation-boundary-here)) | Tenant A's data |
| 3 | Send `X-Scope-OrgID: B` | Unconditionally overwritten ([G2](#61-the-header-is-computed-never-conveyed)) | Tenant A's data |
| 4 | Send `X-Scope-OrgID: A\|B` to append a partition | Overwritten, not merged ([G2](#61-the-header-is-computed-never-conveyed)) | Tenant A's data |
| 5 | Reach the storage backend directly with a chosen header | Backend unreachable except via the gateway, in every environment ([L8](#53-preconditions-for-exposing-query-access)) | No route |
| 6 | Reuse an API token for log queries | Audience rejected ([T9](#34-audience-separation)) | `401` |
| 7 | Use a log token against the API | API guard accepts only the API audience | `401` |
| 8 | Authenticate without the log-read scope | Authorization is required, not just authentication ([T5](#33-authorization)) | `403` |
| 9 | Craft or alter a token | Signature, issuer and expiry validated against our JWKS ([T1](#31-shape-and-validation)) | `401` |
| 10 | Replay another user's token | Bounded lifetime, TLS, single audience; the token still scopes to *its own* tenant | No cross-tenant gain |
| 11 | Enumerate via label or series endpoints instead of queries | Whole read surface is covered by allowlist ([G6](#63-complete-coverage-of-the-read-surface), [G7](#63-complete-coverage-of-the-read-surface)) | Tenant A's label space |
| 12 | Open a live-tail stream to escape header injection | Upgrade path covered explicitly ([G6](#63-complete-coverage-of-the-read-surface)) | Tenant A's data |
| 13 | Guess a per-tenant datasource or gateway URL | No such URL exists ([S1](#7-tenant-selection-is-never-an-input), [S2](#7-tenant-selection-is-never-an-input)) | No route |
| 14 | Present a token with no `tenant_id`, or two | Rejected, no unscoped mode ([T3](#32-claims), [T4](#32-claims)) | `401` |
| 15 | Claim platform-admin for a cross-tenant read | No role bypass on this path ([T11](#35-platform-admin-is-not-a-bypass)) | Tenant A's data |
| 16 | Trigger a resolution failure hoping for a permissive fallback | Fail closed; no widening, no stale cache ([M9](#43-freshness), [M10](#44-failure-behaviour--fail-closed-and-distinguish-none-from-unknown)) | `403` / `5xx` |
| 17 | Force ambiguity by provisioning a second connector | Ambiguity denies rather than tie-breaks ([M11](#44-failure-behaviour--fail-closed-and-distinguish-none-from-unknown)) | Denied |
| 18 | Spoof `Host` or forwarded headers to satisfy the audience check | Expected audience is configured, never derived from the request ([T10](#34-audience-separation)) | `401` |
| 19 | Exhaust the backend with an unbounded query | Global query limits precede exposure ([L7](#53-preconditions-for-exposing-query-access)) | Limited |
| 20 | Read via the write path | Write path is separate and not readable ([G8](#63-complete-coverage-of-the-read-surface)) | No route |

Rows 1–4 and 11–13 share one structural property, and it is the reason this design was chosen:
the caller controls the query completely and controls the partition scope not at all.

### 7.2 Required tests

These tests define what "the contract holds" means. They **MUST** exist as automated,
gating tests owned by the component that implements the rule, and a component **MUST NOT** be
accepted without them. They are specified here by behaviour so the implementing repository
writes them against the contract, not against its own implementation.

**Positive — the intended path works.**

| # | Given | Expect |
|---|---|---|
| P1 | Valid token, log-read scope, tenant A, mapping resolves | Query succeeds; scope is exactly A's own two partitions |
| P2 | Same, but tenant A has no connector | Query succeeds; scope is A's own service partition only |
| P3 | Token carrying only the tenant superuser scope | Allowed — expansion applied ([T6](#33-authorization)) |
| P4 | Tenants A and B each query the same generic dashboard | Each sees only their own lines; neither sees the other's |
| P5 | Label, series, label-values and live-tail endpoints, valid token | Succeed, constrained to the caller's partitions |
| P6 | Connector rotated to a new agent identifier | Subsequent queries reflect the new identifier within the stated bound ([M7](#43-freshness), [M8](#43-freshness)) |
| P7 | Platform operator via the platform path | Full cross-tenant visibility retained — the operator path is not broken by tenant isolation |

**Negative — every one of these must be denied.** Each maps to a threat-model row.

| # | Given | Expect | Threat |
|---|---|---|---|
| N1 | Token with the API audience | `401`; no request forwarded | 6 |
| N2 | Log-audience token against the API | `401` | 7 |
| N3 | Valid token without the log-read scope | `403`; no request forwarded | 8 |
| N4 | Expired, unsigned, wrong-issuer, or wrong-key token | `401` | 9 |
| N5 | No token | `401` | 9 |
| N6 | Inbound `X-Scope-OrgID: B` | Scoped to A; header value never reaches the backend | 3 |
| N7 | Inbound `X-Scope-OrgID: A\|B` | Scoped to A only; no merge | 4 |
| N8 | Inbound partition header on a **rejected** request | Rejected, and nothing forwarded carrying it | 3 |
| N9 | LogQL explicitly selecting tenant B's labels | Succeeds with **zero** rows — not an error, and no B data | 1 |
| N10 | Query via Explore / the datasource API / curl, bypassing dashboards | Scoped to A identically | 2 |
| N11 | Tenant-selecting query parameter, path segment, or body field | Ignored; scoped to A; attempt recorded | 1, 13 |
| N12 | Direct request to the storage backend with a chosen header | Not routable from a tenant-reachable network position, in every environment | 5 |
| N13 | Token with absent, empty, or repeated `tenant_id` | `401` | 14 |
| N14 | Token carrying platform-admin, against the tenant gateway | Scoped to its own tenant; no widening | 15 |
| N15 | Mapping resolution fails (backend error) | Denied; **not** degraded to partial results | 16 |
| N16 | Two active connectors of one type for one tenant | Denied; no tie-break | 17 |
| N17 | Stale cache entry while fresh resolution fails | Denied; stale value not served | 16 |
| N18 | Spoofed `Host` / forwarded headers matching the gateway audience | `401`; audience unaffected | 18 |
| N19 | Live-tail upgrade carrying an inbound partition header | Overwritten on the upgrade path too | 12 |
| N20 | Label-values request naming another tenant's partition | Scoped to A's label space | 11 |
| N21 | Read attempted through the write path | Not readable | 20 |
| N22 | Query exceeding the global limits | Rejected by limits, other tenants unaffected | 19 |

**Rule V1.** N9 is the one to read carefully. A valid query for another tenant's data **MUST**
return an empty result, not an error. An error would confirm that the named tenant exists and
turn the query interface into an oracle for enumerating tenants. Emptiness is indistinguishable
from "no such data", which is exactly the answer a tenant is entitled to.

**Rule V2.** The negative tests **MUST** be written against the deployed boundary — a real
request to the real gateway in front of a real backend — and not solely as unit tests over the
header-building function. The interesting failures in this design are the ones where the
deployment, not the function, lets a request past: an uncovered route, a protocol upgrade, a
permissive network policy, or a direct path to the backend.

**Rule V3.** The isolation tests **MUST** run in every environment where tenants have access,
against that environment's own configuration. Isolation validated only in one environment is
isolation validated only in one environment.
