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
