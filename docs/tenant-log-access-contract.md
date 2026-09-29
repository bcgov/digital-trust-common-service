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

## How to read this

This document is long because it is a boundary several teams build against independently. It is
meant to be entered at the part that concerns you rather than read end to end.

| If you are | Start at |
|---|---|
| Deciding whether to approve it | [Open points](#open-points) below, then [9.1](#91-closing-this-contract) |
| Implementing a component | Your row in [8.1](#81-who-owns-what), then the rules it names, via [Appendix A](#appendix-a-rule-index) |
| Reviewing the boundary | [Section 2](#2-what-tenant-means-in-each-service), then [7.1](#71-threat-model) and [7.2](#72-required-tests) |
| Looking up a single rule | [Appendix A: rule index](#appendix-a-rule-index) |
| Tracing an attack to its control | [7.1](#71-threat-model) and [Appendix B](#appendix-b-remaining-threat-model-rows) |

### What is settled

Each of these is argued where it is stated. The links are the argument, not a summary of it.

- **Logs only.** Metrics and traces stay platform-admin-only, as a design consequence rather
  than a phase ([1.3](#13-logs-only--metrics-and-traces-are-excluded)).
- **The boundary is the storage partition** — not Grafana, not the query, not a label
  ([5.1](#51-isolation-lives-in-the-storage-layer),
  [2.2](#22-grafana-orgs-are-not-an-isolation-boundary-here)).
- **Tenant identity comes from the token and nowhere else**, and tenant selection is never an
  input ([T3](#32-claims), [section 7](#7-tenant-selection-is-never-an-input)).
- **The agent log identifier is the wallet id**, not the API sub-tenant id. The two are not
  interchangeable
  ([2.1](#21-the-agent-sub-tenant-has-two-identifiers-and-they-are-not-interchangeable)).
- **No queryable agent identifier enters the schema.** Uniqueness is enforced on a derived
  value instead ([M3](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)).
- **Every rule has a named owner and an acceptance test**
  ([8.1](#81-who-owns-what), [9.2](#92-accepting-each-external-piece)).

### Open points

Five rules state a requirement that still needs a number or a decision attached to it. They are
what remains before this contract can close under [9.1](#91-closing-this-contract), and this
section is removed once they are settled.

| Rule | What is open |
|---|---|
| [M3](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful) | Uniqueness needs a stored derived value, which is a new column. Needs sign-off, or an alternative that closes the same hole. |
| [M11](#44-freshness) | Five minutes is proposed, not agreed. Both sides of the gateway need the same number. |
| [M17](#46-multiple-connectors-are-not-ambiguous) | The partition-count bound is required but unstated, and has no owner. |
| [L11](#55-preconditions-for-exposing-query-access) | The fairness target between tenants must be measurable, and no number is set. |
| [G10](#64-live-tail-is-not-compatible-with-a-multi-partition-scope) | Live tail defaults to excluded. If tenants need it, fan-in and its obligations are the alternative. |

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

Where a service tenant is reconciled to its agent log identifier, and what constrains that
resolution, is [section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier). The rules
that keep it independent of any one agent are [4.3](#43-agent-agnostic-by-construction).

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
This is deliberately the same validation the API's own JWT guard performs, so neither validator
is a weaker path to the other's data.

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
| `roles` | No | Omitted entirely for machine clients with no roles. See [3.5](#35-platform-admin-is-not-a-bypass) — carries **no** tenant-scoping meaning here, and its absence **MUST NOT** be treated as an authentication failure. |

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
clients — is useless for reading logs, provided the single-audience invariant in
[Rule T12](#34-audience-separation) holds.

**Rule T10.** The gateway's audience value **MUST** be configured explicitly and **MUST NOT**
be derived from the request — not from the `Host` header, not from a forwarded proto or host
header, and not from the request URL. Deriving the expected audience from attacker-influenced
input would make the audience check self-satisfying.

**Rule T12.** A token **MUST** carry exactly one audience value, and both validators **MUST**
enforce that. Ordinary JWT audience validation checks *membership*, so a token whose `aud` is
an array containing both the API audience and the gateway audience would satisfy both
validators and defeat the separation above. Single-audience issuance is therefore a **security
invariant of this contract**, not an incidental property of how tokens happen to be minted
today, and it **MUST** be asserted by a test on the issuing side and enforced by rejection on
both validating sides.

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

### 3.6 Transport

**Rule T13.** Every hop that carries a token **MUST** be TLS-protected — browser to Grafana,
Grafana to gateway, and gateway to storage backend. A plaintext hop carrying a bearer token
**MUST NOT** exist in any environment, and an external plaintext request **MUST** be refused or
redirected rather than served. This is what makes the token-replay entry in the threat model a
bounded risk rather than a passive-capture one.

## 4. Mapping a service tenant to its agent log identifier

To show a service tenant the lines its agent produced on its behalf, the gateway must resolve
the service tenant to that tenant's **agent log identifier**
([2.1](#21-the-agent-sub-tenant-has-two-identifiers-and-they-are-not-interchangeable)).

This section specifies that resolution as a **constraint on where the answer may come from and
how it must behave**. It deliberately does not name a column, a table, a cache, or a service
boundary. Those are implementation choices, and the contract is satisfied by any
implementation that holds the constraints below.

### 4.1 Provenance — the identifier must be trustworthy before it is useful

The agent log identifier is the key that unlocks a set of log lines. Whoever controls its value
for a tenant controls which lines that tenant can read. It therefore **MUST NOT** be a value the
requesting tenant can choose.

This needs stating explicitly because a tenant configures its own connector, including the
endpoint URL the connector talks to. An identifier read from a token issued by a
tenant-nominated endpoint is, without further constraint, a value that tenant asserted about
itself.

**Rule M1.** The identifier **MUST** originate from an agent the platform trusts, established
independently of the request that supplies it — by an allowlist of acceptable agent endpoints,
or by an equivalent out-of-band control. An identifier obtained from an agent endpoint that has
not been established as trusted **MUST NOT** be used for log partitioning.

Verifying the *issuer* of the token the identifier is read from is **not**, on its own, a
sufficient control, and **MUST NOT** be treated as one unless the token's signature is
verifiable against a key the platform holds independently of the connector record. Today it is
not: the agent's token is decoded without signature verification, because we hold no key for
the agent. An issuer string inside an unverified token fetched from a tenant-nominated endpoint
is a value the tenant chose. An implementer who picks that option would believe Rule M1 were
satisfied when it is not, which is why it is called out rather than left to judgement.

**Rule M2.** Each agent log identifier **MUST** belong to **exactly one** service tenant. This
**MUST** be enforced when the identifier is written, atomically, so that a second tenant cannot
bind the same identifier — concurrently or later. Binding **MUST** fail rather than displace an
existing binding held by **another** tenant.

Re-binding an identifier to the tenant that **already holds it** is a different case and **MUST**
succeed: it is idempotent, not a conflict. Without this, the ordinary lifecycle deadlocks — a
tenant that deletes and re-creates a connector against the same sub-wallet, or rotates its
credentials, presents the same identifier again and would be refused, losing access to its own
agent logs permanently with no diagnosable response ([M15](#45-failure-behaviour)).

**Rule M3.** Enforcing Rule M2 **MUST NOT** require storing the agent identifier as queryable
plaintext, and **MUST NOT** create a reverse lookup from an identifier to a service tenant. A
non-reversible derived value — a keyed hash of the connector type and identifier, held under a
uniqueness constraint — satisfies both: it makes double-binding impossible to write while
remaining useless for asking whose identifier something is.

> **This is the one place the contract adds a write-time obligation that the connector design
> does not already have.** It is deliberate. Uniqueness cannot be checked at read time without
> the reverse lookup [Rule M5](#42-provenance-at-query-time) prohibits, and without uniqueness
> a single mis-bound or maliciously bound identifier is a silent cross-tenant read rather than
> an empty result.

### 4.2 Provenance at query time

**Rule M4.** The identifier **MUST** be resolved from the **requesting service tenant's own
connector records**, reached by that tenant's `tenant_id`.

**Rule M5.** Resolution **MUST NOT** scan, join, or search across connector records belonging
to other service tenants, and **MUST NOT** consult any global index, registry, or reverse
lookup keyed by the agent identifier. The query is "what are this tenant's identifiers", never
"whose identifier is this".

**Rule M6.** No dedicated schema is introduced for *lookup*. The connector's credential material
is already a per-connector-type set of values held together; the agent log identifier is another
value in that set. The only addition this contract requires is the uniqueness guard of
[Rule M3](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful), which stores
a derived value rather than the identifier.

**Rule M7.** The identifier is **not** a secret — it is emitted in plaintext on every agent log
line, so this contract places no at-rest confidentiality requirement on it and does not weaken
the protection of anything stored alongside it. That is distinct from
[Rule M15](#45-failure-behaviour): not being a secret does not make it disclosable to *another*
tenant.

### 4.3 Agent-agnostic by construction

**Rule M8.** Resolution **MUST** be expressed in terms of the connector's type, not hardcoded to
the agent deployed today. Each connector type supplies its own log identifier under its own
name. A future agent must be supportable by teaching its connector type where its identifier
lives — not by a schema migration, and not by a change to this contract.

**Rule M9.** The gateway **MUST NOT** interpret the identifier's meaning or assume its format —
not that it is a UUID, and not that it resembles any other identifier we hold. It **MUST**
nonetheless be validated and encoded before use as a partition key, per
[Rule L8](#54-partition-keys-must-be-derived-not-passed-through). Treating it as opaque is about
not ascribing meaning to it; it is not licence to pass an arbitrary byte string into a header.

### 4.4 Freshness

**Rule M10.** The resolved identifier **MUST** be refreshed when the tenant's connector
credentials are rotated or replaced. A connector may be re-provisioned against a new sub-wallet,
in which case the old identifier is simply wrong.

**Rule M11.** Any cache **MUST** be bounded in size and **MUST** have a maximum staleness of
**five minutes**, which is the outer bound within which a rotation must become visible even if
no invalidation signal arrives. A shorter bound is acceptable; an unbounded one is not. The
bound is stated here rather than left to the implementation because it is the interval during
which a revoked or re-provisioned binding is still honoured, and the teams either side of the
gateway need the same number.

**Rule M12.** Cache entries **MUST** be keyed by the service tenant and **MUST** be invalidated
on connector credential change. A cache **MUST NOT** be keyed by, or allow retrieval by, the
agent log identifier — that would be the reverse lookup [Rule M5](#42-provenance-at-query-time)
prohibits, reintroduced at the cache layer.

**Rule M13.** Invalidation is an **optimisation, not a correctness mechanism**. Rule M11's
staleness bound **MUST** hold whether or not an invalidation signal is delivered, so a dropped
or failed signal degrades latency rather than correctness. This matters because invalidation
crosses a repository boundary, where delivery cannot be assumed.

### 4.5 Failure behaviour

**Rule M14.** Resolution **MUST** fail closed. No case widens the scope, falls back to a
default, or omits the partition constraint.

| Case | Meaning | Behaviour |
|---|---|---|
| Tenant has no connector configured | The tenant has not been onboarded to an agent | Serve **this service's** lines for that tenant only. Not an error — a tenant with no agent legitimately has no agent logs. |
| Connector exists but carries no log identifier | Configured before the identifier was captured, or the agent did not supply one | Serve this service's lines only, and omit that connector's partition. Surface as an operator-visible condition — it is a resolvable configuration gap, and silently degrading hides it. |
| Connector is inactive | Deactivated, or the tenant is deactivated | Treat as absent. **MUST NOT** resolve an identifier from an inactive connector. |
| Identifier fails validation or encoding | Unusable as a partition key ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | **Deny the whole request.** |
| Resolution errors | Datastore unavailable, decryption failure, unexpected shape | **Deny the whole request.** **MUST NOT** degrade to this service's lines only — a failure of the isolation machinery is not a partial-results condition. |

**Rule M15.** All externally visible **failures** of this resolution — the two rows above that
deny — **MUST** be indistinguishable from one another: one status code and one generic body,
whether the cause was an unusable identifier or a backend error. The distinctions in the table
exist for the operator, through logs and metrics. A caller **MUST NOT** be able to learn from a
response whether another service tenant exists, how many connectors **another** tenant has, or
any identifier belonging to another tenant.

The first three rows are **not** failures and are deliberately outside this rule. A tenant with
no agent receives its own service lines and a successful response, which is correct and is not
a disclosure: that a caller has no connector of its own is the caller's own data. Requiring
those to be indistinguishable from a denial would force us to deny every tenant that has not
yet onboarded an agent.

### 4.6 Multiple connectors are not ambiguous

A tenant may hold several active connectors, of the same type or of different types. Every one
of them belongs to that tenant.

**Rule M16.** The resolved set **MUST** be the log identifiers of **all** the requesting
tenant's active connectors that have one. This is not an ambiguity to be resolved — each
identifier's lines are that tenant's lines — and an implicit tie-break (most recent, lowest id,
first returned) **MUST NOT** be used, because it would silently hide part of the tenant's own
data behind whichever connector happened to sort first.

**Rule M17.** The number of partitions in a single scope **MUST** be bounded, and a tenant
exceeding the bound **MUST** be denied rather than silently truncated. Truncation is the
tie-break of Rule M16 wearing a different hat: it returns a confident, incomplete answer.

> Rule M16 is only safe because of [Rule M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful).
> Without single-tenant ownership of each identifier, widening the scope to every connector a
> tenant holds would widen the blast radius of a mis-binding in exact proportion.

### 4.7 The binding is system-owned, not tenant-supplied

[Rule M6](#42-provenance-at-query-time) puts the identifier alongside the connector's other
per-connector-type credential values. That is the right home — it keeps the agent out of the
schema — but it places the identifier in a structure the tenant writes, and writes **wholesale**:
a connector create or update carries the whole credential set from a tenant-authored request.

Rule M1 constrains where an identifier may be *read from*. It does not, by itself, stop a tenant
simply **typing another tenant's identifier into its own connector**, which is the shortest path
to the same outcome and needs closing separately.

**Rule M18.** The agent log identifier **MUST** be system-populated. A value for it supplied by
a caller on any tenant-facing write **MUST** be ignored or the request rejected, and **MUST NOT**
be persisted or used for partitioning under any circumstances. Being stored in a tenant-writable
structure **MUST NOT** make it a tenant-writable field.

This is load-bearing in both directions. Without it, [Rule M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)
turns into a weapon: because the first writer wins, a tenant that successfully squats on another
tenant's identifier not only reads that tenant's logs but **permanently locks the rightful owner
out of its own**, and does so through the ordinary connector API.

**Rule M19.** Replacing, rotating, or partially updating a tenant's credential material **MUST
NOT** silently clear or orphan an established binding. A routine credential rotation that drops
the identifier degrades the tenant to service-lines-only
([M14](#45-failure-behaviour)) with no error — a loss of function that looks exactly like never
having onboarded.

**Rule M20.** A binding **MUST** be released when the connector holding it is deleted or the
tenant is deactivated, so the same tenant — or, after release, a different one — can bind that
identifier again. A uniqueness record that outlives the connector it describes makes
[Rule M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful) permanent
rather than current, and turns connector deletion into an irreversible loss of log access.

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

### 5.3 The routing field must be trusted, not merely structured

Structured is not the same as trustworthy. A JSON log line is still, in part, application data:
it can carry a user-supplied value, a merged context object, or a duplicated key. If a line
produced while serving tenant A can be made to carry tenant B's routing value, the collector
will file A's content in a partition B can read — and it will do so silently, because from the
collector's point of view nothing went wrong.

**Rule L6.** The routing field **MUST** be populated by trusted logging infrastructure — the
service's own logging middleware or the agent's runtime — and **MUST NOT** be sourceable from
application payload, request data, user-supplied content, or a caller-influenced log argument.
The extraction **MUST** read only the field the trusted layer owns, never a same-named field
appearing elsewhere in the line.

**Rule L7.** Where a line carries conflicting, duplicated, or malformed routing values, the
collector **MUST** route it to the platform partition rather than choosing among them. Precedence
between duplicate keys **MUST** be defined explicitly rather than inherited from whatever a
parser happens to do, because parsers disagree about which duplicate wins.

### 5.4 Partition keys must be derived, not passed through

Loki constrains partition identifiers, and the read path pipe-joins them. Both facts make a
pass-through of a raw agent identifier unsafe.

**Rule L8.** The partition key **MUST** be a canonical, domain-separated value derived from the
source identifier by a single definition shared by ingestion and query. It **MUST** be
constrained to characters the backend accepts, **MUST** be within the backend's length limit,
and **MUST NOT** be able to contain the multi-partition separator `|` or any path, control, or
delimiter character. Raw identifiers **MUST NOT** be used as partition keys.

The reasons are concrete rather than theoretical:

- Loki rejects partition identifiers outside a restricted character set, rejects values over
  **150 bytes**, and reserves `|` as the multi-partition separator. An identifier containing `|`
  does not fail — it **widens the read scope**.
- Partition identifiers become object-storage path prefixes, so path characters are unsafe.
- Without domain separation, a service tenant's identifier, an agent identifier, and the
  identity the **write path** assigns to an existing direct-push producer all occupy one
  namespace and can collide. The write path matters as much as the read path here: a push
  credential whose derived identity collides with a tenant's partition key writes
  attacker-chosen lines **into** that tenant's read scope.
  [Rule G9](#63-complete-coverage-of-the-read-surface) covers reading *through* the write path;
  it does not cover writing *into* a tenant partition.

**Rule L9.** Ingestion and the gateway **MUST** apply the same derivation. A derivation applied
on only one side produces a partition that is written to and never read, or read from and never
written — and the failure mode is an empty result, which is easily mistaken for "no logs yet".

### 5.5 Preconditions for exposing query access

**Rule L10.** A global query limits configuration (query length, series, rate, cardinality)
**MUST** be in place before any tenant is granted query access. Arbitrary LogQL from external
callers without limits is a denial-of-service surface against every other tenant sharing the
backend. The limits are global and enforced per partition; per-partition overrides are for
known exceptions only.

**Rule L11.** Query-shape limits alone are **not** sufficient for availability isolation. A
caller can stay inside every per-query limit and still exhaust shared scheduler and querier
capacity by volume. Per-partition **request rate, concurrent/outstanding query, and timeout**
controls **MUST** also be configured, and the fairness expectation between tenants **MUST** be
stated as a measurable target rather than left implicit.

**Rule L12.** Loki **MUST NOT** be reachable except through a gateway that sets the partition
header, in **every** environment — including development and test. An environment where the
storage backend accepts a caller-supplied partition header from anywhere in the cluster has no
boundary at all, and it is where the isolation tests would otherwise be validated against a
configuration that does not match production.

## 6. The gateway header contract

The gateway's entire job is to turn a validated identity into a partition scope. It is
security-critical and deliberately narrow.

### 6.1 The header is computed, never conveyed

**Rule G1.** The gateway **MUST** set the `X-Scope-OrgID` header itself, computed solely from
the validated token's `tenant_id` ([Rule T3](#32-claims)) and the identifiers resolved under
[section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier), each encoded per
[Rule L8](#54-partition-keys-must-be-derived-not-passed-through). No other input contributes.

**Rule G2.** The gateway **MUST** unconditionally overwrite any inbound `X-Scope-OrgID`,
regardless of its value, and **MUST NOT** append to, merge with, or take any part of it. A
caller-supplied value is never echoed and never contributes — it is replaced before the
request is forwarded. This must hold on rejected requests too: nothing reaches the storage
backend carrying a caller-influenced partition header under any outcome.

**Rule G3.** The scope **MUST** be exactly the requesting service tenant's own partitions: this
service's partition for that tenant, plus the partition of each of that tenant's active
connectors that resolved an identifier ([Rule M16](#46-multiple-connectors-are-not-ambiguous)).
It **MUST NOT** include a platform partition, a default partition, a wildcard, or any partition
belonging to another service tenant. Multi-partition querying must be enabled in the backend.

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
enumerate tenants, hosts, and operations.

**Rule G7.** Route handling **MUST** be an allowlist: any path not explicitly enumerated and
covered is denied. A backend version that adds a new read endpoint must therefore be
unreachable until someone enumerates it. A denylist fails open on exactly the routes nobody has
thought about yet.

**Rule G8.** Denial of an unknown or unenumerated route **MUST** be generic and identical
regardless of why the path was unknown, so route handling cannot be used to probe what exists
behind the gateway.

**Rule G9.** No read path to the storage backend that bypasses the gateway may be reachable by
a tenant user, in any environment. The write path is a separate concern with its own
authentication, and it **MUST NOT** be usable to read.

### 6.4 Live tail is not compatible with a multi-partition scope

This is a backend constraint, not a design preference, and it has to be decided rather than
discovered during implementation.

Loki supports multi-partition scopes **only on query endpoints**. `GET /loki/api/v1/tail`
returns `400` when more than one partition is named in the header. Since
[Rule G3](#61-the-header-is-computed-never-conveyed) gives every tenant with an agent connector
a scope of two or more partitions, live tail cannot simply be proxied like the other routes.

**Rule G10.** Live tail **MUST** be handled by exactly one of:

1. **Excluded** from the allowlist, so tail requests receive the same generic denial as any
   other unenumerated route ([G8](#63-complete-coverage-of-the-read-surface)); or
2. **Fanned in** by the gateway: one upstream tail stream per authorized partition, merged into
   the single stream returned to the caller, with the partition scope still set by the gateway
   on each upstream connection.

**Rule G11.** Option 1 is the default. Option 2 **MUST NOT** be adopted without also specifying
and testing its per-connection resource limits, cancellation and teardown on client disconnect,
reconnect behaviour, and re-authorization on reconnect — a long-lived stream outlives the token
that opened it, which no request-scoped check covers. Fan-in is a stateful proxy, and header
injection alone does not make it safe.

## 7. Tenant selection is never an input

This section is the negative space of the whole contract, stated once and explicitly, because
every mechanism below is a natural thing for an implementer to add and each one would silently
convert the boundary into a suggestion.

**Rule S1.** The partition scope **MUST** be derived solely from the validated token and the
resolution in [section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier). It **MUST
NOT** be influenced, in whole or in part, by any of:

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

**Rule S4.** On an **allowlisted route**, a tenant-selecting parameter, body field, or header
**MUST** be served as though the attempt were absent — scoped to the caller's own tenant —
rather than rejected with an error that confirms the mechanism exists. Silent neutralisation
gives the caller no signal to probe against.

**Rule S5.** A tenant-selecting **path** is not covered by Rule S4. Because no such path exists
([S2](#7-tenant-selection-is-never-an-input)), a request to one is simply an unenumerated route
and **MUST** receive the same generic denial as any other
([G7](#63-complete-coverage-of-the-read-surface), [G8](#63-complete-coverage-of-the-read-surface)).
Rules S4 and G7 do not conflict: S4 governs *inputs to a route that exists*, G7 governs *whether
the route exists at all*.

**Rule S6.** Every attempt under Rules S4 and S5 **MUST** be recorded for the operator. The
caller learns nothing; we learn that someone probed.

### 7.1 Threat model

Each row is an attacker with a **valid token for tenant A** attempting to read tenant B, which
is the realistic adversary: a legitimate tenant user, authenticated, with full control of
their own HTTP client — and, importantly, able to configure their own connector.

Thirty-one attacks are enumerated. The six below are the ones specific to this design — the
places where a caller influences *data* rather than the *query*. The other twenty-five are the
standard token, header and route attacks, and they are in
[Appendix B](#appendix-b-remaining-threat-model-rows). Numbering is continuous across both
tables, so the `Threat` column in [7.2](#72-required-tests) resolves against either.

| # | Attack | Control | Outcome |
|---|---|---|---|
| 13 | **Supply tenant B's agent identifier directly in A's own connector credentials** | The identifier is system-populated; a caller-supplied value is never persisted or used ([M18](#47-the-binding-is-system-owned-not-tenant-supplied)), and each identifier belongs to exactly one tenant, enforced at write ([M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)) | Value discarded |
| 14 | **Point a connector at an attacker-run endpoint that asserts an arbitrary identifier** | Only identifiers from a trusted agent are usable for partitioning ([M1](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)) | Identifier unusable |
| 15 | **Smuggle `\|` or a path character into an identifier to widen the scope** | Partition keys are derived, charset-constrained and length-bounded; raw values are never passed through ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | Rejected |
| 16 | **Get tenant B's routing value onto a line produced for A**, via user-controlled payload or a duplicated JSON key | Routing field is owned by trusted logging infrastructure and read only from there; conflicts route to the platform partition ([L6](#53-the-routing-field-must-be-trusted-not-merely-structured), [L7](#53-the-routing-field-must-be-trusted-not-merely-structured)) | Platform partition |
| 30 | **Write** into a tenant's partition via a direct-push credential whose identity collides with a derived key | The write-path identity namespace is domain-separated from tenant and agent keys ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | No collision |
| 31 | Squat an unbound identifier to lock a tenant out of its own future logs | Caller-supplied identifiers are never persisted ([M18](#47-the-binding-is-system-owned-not-tenant-supplied)); bindings are released on connector deletion ([M20](#47-the-binding-is-system-owned-not-tenant-supplied)) | Squat impossible |

Rows 1–5, 17 and 20 share one structural property, and it is the reason this design was chosen:
the caller controls the query completely and controls the partition scope not at all. Rows
13–16, 30 and 31 are the counterweight — the places where a caller influences *data* rather than
the *query*. That is where this design is actually fragile, and it is where most of these rules
sit: the query path is safe by construction, the write path is safe only by discipline.

### 7.2 Required tests

These tests define what "the contract holds" means. They **MUST** exist as automated, gating
tests owned by the component that implements the rule, and a component **MUST NOT** be accepted
without them. They are specified by behaviour so the implementing repository writes them against
the contract, not against its own implementation.

**Positive — the intended path works.**

| # | Given | Expect | Owner |
|---|---|---|---|
| P1 | Valid token, log-read scope, tenant A, one connector resolving | Query succeeds; scope is exactly A's service partition plus that connector's | Gateway |
| P2 | Tenant A has no connector | Query succeeds; scope is A's service partition only | Gateway |
| P3 | Token carrying only the tenant superuser scope | Allowed — expansion applied ([T6](#33-authorization)) | Gateway |
| P4 | Tenants A and B each open the same generic dashboard | Each sees only their own lines | Grafana + gateway |
| P5 | Tenant A has several active connectors, including of different types | Scope includes **all** of A's resolved partitions, none of B's ([M16](#46-multiple-connectors-are-not-ambiguous)) | Gateway |
| P6 | Label, series and label-values endpoints, valid token | Succeed, constrained to the caller's partitions | Gateway |
| P7 | Connector rotated to a new identifier, **no** invalidation signal delivered | New identifier in effect within the staleness bound ([M11](#44-freshness), [M13](#44-freshness)) | This service + gateway |
| P8 | Platform operator via the platform path | Full cross-tenant visibility retained | Platform observability |
| P9 | An identifier is bound to a tenant for the first time | Binding succeeds and is usable | This service |
| P10 | An agent line emitted for tenant A, carrying A's identifier field | Lands in A's partition and is returned to A's token, and to no other tenant's | Agent deployment + Platform observability |
| P11 | Tenant A deletes and re-creates a connector against the same sub-wallet, then rotates its credentials | Binding succeeds both times and A's agent logs stay visible ([M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful), [M19](#47-the-binding-is-system-owned-not-tenant-supplied), [M20](#47-the-binding-is-system-owned-not-tenant-supplied)) | This service |

**Adversarial — each must produce the stated safe outcome.** Some outcomes are a rejection and
some are a correctly scoped success; both are passes. A case that "succeeds" here is not a
weaker result — it is the demonstration that the attack changed nothing.

| # | Given | Expect | Threat | Owner |
|---|---|---|---|---|
| N1 | Token with the API audience | `401`; nothing forwarded | 6 | Gateway |
| N2 | Log-audience token against the API | `401` | 7 | This service |
| N3 | Signed token whose `aud` contains **both** audiences | `401` from both validators; issuance never produces one | 8 | This service + gateway |
| N4 | Valid token without the log-read scope | `403`; nothing forwarded | 9 | Gateway |
| N5 | Expired, unsigned, wrong-issuer, or wrong-key token | `401` | 10 | Gateway |
| N6 | No token, or a cookie / basic-auth / upstream / agent token instead ([T2](#31-shape-and-validation)) | `401` | 10 | Gateway |
| N7 | Token with absent, empty, or repeated `tenant_id` | `401` | 21 | Gateway |
| N8 | Token carrying platform-admin | Scoped to its own tenant; no widening | 22 | Gateway |
| N9 | Sequential requests with tenant A's then tenant B's token on one connection | Each scoped to its own tenant; no decision reuse ([T7](#33-authorization)) | — | Gateway |
| N10 | Inbound `X-Scope-OrgID: B` | Scoped to A; that value never reaches the backend | 3 | Gateway |
| N11 | Inbound `X-Scope-OrgID: A\|B` | Scoped to A only; no merge | 4 | Gateway |
| N12 | Inbound partition header on a **rejected** request | Rejected, and nothing forwarded carrying it | 3 | Gateway |
| N13 | Forwarded request inspected at the backend | No `Authorization` header present ([G4](#61-the-header-is-computed-never-conveyed)) | — | Gateway |
| N14 | LogQL explicitly selecting tenant B's labels, with a **B-owned canary** line present | Succeeds; the canary is **not** returned. A-owned lines that happen to match may be | 1 | Gateway |
| N15 | Query via Explore / the datasource API / curl, bypassing dashboards | Scoped to A identically | 2 | Gateway |
| N16 | Tenant-selecting parameter or body field on an allowlisted route | Ignored; scoped to A; attempt recorded ([S4](#7-tenant-selection-is-never-an-input), [S6](#7-tenant-selection-is-never-an-input)) | 1 | Gateway |
| N17 | Tenant-selecting **path**, or any unenumerated route | Generic denial, identical for every unknown path ([S5](#7-tenant-selection-is-never-an-input), [G8](#63-complete-coverage-of-the-read-surface)) | 20 | Gateway |
| N18 | A backend read route that exists but is not enumerated | Denied ([G7](#63-complete-coverage-of-the-read-surface)) | 17 | Gateway |
| N19 | Label-values request naming another tenant's partition | Scoped to A's label space | 17 | Gateway |
| N20 | Live-tail request | Generic denial; or, under fan-in, per-partition streams with teardown and reconnect re-authorization ([G10](#64-live-tail-is-not-compatible-with-a-multi-partition-scope), [G11](#64-live-tail-is-not-compatible-with-a-multi-partition-scope)) | 18, 19 | Gateway |
| N21 | Direct request to the storage backend with a chosen header | Not routable from a tenant-reachable network position, in every environment | 5 | Platform observability |
| N22 | Plaintext request to any token-bearing hop | Refused or redirected; no token accepted over plaintext | 12 | Platform observability |
| N23 | Tenant B attempts to bind an identifier already bound to tenant A | Binding **refused**; A's binding unchanged | 13 | This service |
| N24 | Two tenants attempt to bind the same identifier concurrently | Exactly one succeeds | 13 | This service |
| N25 | Connector pointed at an untrusted endpoint asserting an identifier | Identifier not usable for partitioning ([M1](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)) | 14 | This service |
| N26 | Identifier containing `\|`, a path or control character, or over the length limit | Rejected; never reaches a header ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | 15 | This service + gateway |
| N27 | Two different source identifiers deriving to the same partition key | Collision detected, not silently shared | 15 | This service + gateway |
| N28 | Log line carrying a foreign routing value via request data, user content, or a duplicate JSON key | Routed to the platform partition, never to the named tenant ([L6](#53-the-routing-field-must-be-trusted-not-merely-structured), [L7](#53-the-routing-field-must-be-trusted-not-merely-structured)) | 16 | Platform observability |
| N29 | Agent line with no extractable identifier | Platform partition; never a tenant partition ([L4](#52-partitioning-happens-at-ingestion)) | 16 | Platform observability |
| N30 | Connector inactive, or present with no identifier | That partition omitted; service lines still served ([M14](#45-failure-behaviour)) | 23 | Gateway |
| N31 | Resolution fails with a backend error | Denied; **not** degraded to partial results | 23 | Gateway |
| N32 | Responses compared across an unusable identifier and a backend error | Indistinguishable status and body. A tenant with no connector is a **success** and is correctly distinguishable ([M15](#45-failure-behaviour)) | 24 | Gateway |
| N33 | Any failure response body inspected | No other tenant's identifier, no connector count, no tenant existence signal | 24 | Gateway |
| N34 | Identifier rotated; queries issued at the staleness bound and just after | Old binding not honoured past the bound | 25 | Gateway |
| N35 | Spoofed `Host` / forwarded headers matching the gateway audience | `401`; audience unaffected | 26 | Gateway |
| N36 | Query exceeding the global limits | Rejected by limits; other tenants unaffected | 27 | Platform observability |
| N37 | Tenant A floods many individually compliant queries | Tenant B stays within the agreed latency and error target ([L11](#55-preconditions-for-exposing-query-access)) | 28 | Platform observability |
| N38 | Read attempted through the write path | Not readable | 29 | Platform observability |
| N39 | Tenant supplies a log identifier directly in a connector create or update request | Not persisted, not used for partitioning, attempt recorded ([M18](#47-the-binding-is-system-owned-not-tenant-supplied)) | 13, 31 | This service |
| N40 | Direct-push credential whose identity derives to a tenant's partition key | Refused; no write into a tenant partition ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | 30 | Platform observability |
| N41 | Tenant's resolved partition count exceeds the bound | Denied, never silently truncated ([M17](#46-multiple-connectors-are-not-ambiguous)) | — | Gateway |

**Rule V1.** N14 is the one to read carefully. A query naming another tenant **MUST** return no
line belonging to that tenant, and **MUST NOT** return an error. An error would confirm that the
named tenant exists and turn the query interface into an oracle for enumerating tenants. The
assertion is therefore "**no B-owned canary is returned**", not "zero rows" — the caller's own
partition may legitimately contain a line whose label or text happens to match the string they
supplied, and demanding zero rows would make a correct implementation fail the test.

**Rule V2.** The adversarial tests **MUST** be written against the deployed boundary — a real
request to the real gateway in front of a real backend — and not solely as unit tests over the
header-building function. The interesting failures in this design are the ones where the
deployment, not the function, lets a request past: an uncovered route, a protocol upgrade, a
permissive network policy, or a direct path to the backend.

**Rule V3.** The isolation tests **MUST** run in every environment where tenants have access,
against that environment's own configuration. Isolation validated only in one environment is
isolation validated only in one environment.

## 8. External ownership

Most of this contract is implemented outside this repository. That is the main reason it
exists as a written contract rather than as review comments on a pull request: no single team
can verify the boundary end to end from inside their own component, so each one needs to know
precisely what the others guarantee.

Named repositories and teams are recorded on the tracking work rather than here, so this
document does not go stale when either changes. The split of responsibility does not change.

### 8.1 Who owns what

The split matters in one particular way: the rules about the token are **issuer** obligations
for this service and **verifier** obligations for the gateway, and they are not the same work.
Issuing a correctly shaped token does not enforce anything; enforcing on a token this service
did not shape is not possible. Both halves are required, and each is listed against the owner
who performs it.

| Owner | Responsibility | Rules they implement |
|---|---|---|
| **This service** | Minting the access token with the tenant claim, the log-read scope, and the log gateway resource audience, with exactly one audience per token; rejecting log-audience tokens on the API; establishing identifier provenance and binding each agent log identifier to exactly one tenant, system-owned and released on deletion; refreshing it on rotation; exposing the resolution the gateway consumes | T1 (issuance), T3–T4 (issuance), T6 (definition), T8, T12, M1–M8, M10, M18–M20, L8–L9 (derivation definition) |
| **Identity-aware gateway** | Token validation and authorization on every request, mapping consumption, partition scope composition and header construction, read-surface coverage, fail-closed and uniform failure behaviour | T1, T2, T3–T4 (enforcement), T5, T6 (enforcement), T7, T9–T11, M9, M11–M17, G1–G11, L8–L9 (read-side application), S1, S4–S6 |
| **Platform observability (GitOps)** | Storage-layer multi-tenancy including the multi-partition read scope the gateway depends on, collector partition routing and routing-field trust, query and fairness limits, TLS on every token-bearing hop, network isolation of the backend in every environment, write-path partition assignment for existing direct-push consumers | L1–L4, L6, L7, L8–L9 (ingestion application), L10–L12, T13, backend half of G3, G9 |
| **Agent deployment (GitOps)** | Structured log output carrying the agent's log identifier as a discrete field, populated by the agent runtime rather than from request data | L5, agent half of L6 |
| **Platform Grafana** | The dedicated tenant-facing instance, registered against this service as its identity provider; a single shared datasource forwarding the caller's token; generic dashboards | S2, S3 |

### 8.2 Sequencing

The dependencies between these are real, and taking them out of order produces either a broken
deployment or a boundary that looks present and is not.

1. **The agent emits structured logs first.** Until it does, there is no discrete identifier to
   route on, and routing must not be attempted against unstructured text ([L5](#52-partitioning-happens-at-ingestion)).
   Until then the agent's lines stay in the platform partition and tenants see only this
   service's lines — a usable intermediate state, not a blocked one.
2. **Query limits, fairness controls and network isolation land before any tenant gets access**
   ([L10](#55-preconditions-for-exposing-query-access), [L11](#55-preconditions-for-exposing-query-access),
   [L12](#55-preconditions-for-exposing-query-access)). These are preconditions for exposure, not
   follow-ups: after exposure, adding them is a regression risk rather than a safe default.
3. **The storage multi-tenancy cutover is coordinated, not a flag flip.** Enabling native
   tenancy makes the partition header mandatory on **ingestion** as well as query. Any existing
   producer that pushes directly, outside the collector, starts failing at that moment unless
   the write path assigns its partition first. Assignment must be in place before or atomically
   with the cutover, verified in a lower environment, and the affected team told ahead of the
   production change even though their client should not need to change.
4. **The gateway and the tenant Grafana land last**, once the token surface and the storage
   boundary both exist. Standing up the access layer earlier would mean either exercising it
   against an unenforced backend — validating nothing — or creating a path that is open while
   its enforcement is still in flight.

### 8.3 What this repository guarantees to the others

So the external owners can build against a fixed surface:

- The token is signed by this service, discoverable through its OIDC metadata and JWKS, and
  validated the same way the API validates its own ([T1](#31-shape-and-validation)).
- `tenant_id` is a single, stable, opaque identifier for one service tenant, and it is the
  value our own log lines carry.
- The log gateway audience is a configured resource identifier, distinct from the API audience,
  and a token resolves to exactly one of them ([T8](#34-audience-separation), [T9](#34-audience-separation)).
- The log-read scope is a real, assignable scope, granted per tenant, and expanded consistently
  with the API ([T6](#33-authorization)).
- Each agent log identifier is bound to exactly one service tenant, resolvable per tenant,
  refreshed on connector rotation within a stated staleness bound, and fails closed and
  uniformly rather than returning a guess ([section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier)).
- Onboarding a tenant requires **no** configuration change in any external component: no
  collector reload, no Grafana object, no datasource, no dashboard, and no partition
  pre-registration.

### 8.4 What this repository depends on

- The agent emits its log identifier as a discrete field in structured output.
- The storage backend enforces partition isolation and has multi-partition reads enabled, since
  every tenant with a connector has a scope of more than one partition
  ([G3](#61-the-header-is-computed-never-conveyed)).
- The routing field on an agent log line is populated by the agent runtime and is not
  reachable from request data ([L6](#53-the-routing-field-must-be-trusted-not-merely-structured)).
- The backend is unreachable except through a gateway that sets the partition header, in every
  environment.
- The tenant Grafana forwards the caller's token to the datasource unchanged.

---

## 9. Acceptance and closure

### 9.1 Closing this contract

This contract is complete when it is **agreed**, not when it is implemented. It closes on:

- the identifier glossary ([section 2](#2-what-tenant-means-in-each-service)) reviewed and
  agreed by the teams owning each system in it, since its whole purpose is to stop two of those
  rows being conflated;
- the token, mapping, storage, header, and selection rules accepted as binding by the
  implementing owners in [8.1](#81-who-owns-what);
- a security review of exposing tenant-facing observability data, taken against this document;
- each owner having the rules they implement reflected in their own tracked work.

It does **not** wait on any implementation. Blocking the contract on the work it specifies
would invert the dependency — the implementing work is written against this document.

### 9.2 Accepting each external piece

Acceptance criteria per owner. Each is verifiable by someone other than its author, which is
the point.

Each owner is accepted when the tests assigned to them in
[7.2](#72-required-tests) all pass — noting that a pass is sometimes a denial and sometimes a
correctly scoped success, and that a test naming two owners is verified jointly rather than
twice.

| Owner | Accepted when |
|---|---|
| **This service** | **P9, P11, N2, N23–N25, N39** pass, plus **P7, N3, N26, N27** jointly with the gateway: a token requested for the log gateway audience carries that audience alone and is rejected by the API; the log-read scope is grantable and expands consistently; an agent log identifier is captured only from a trusted agent, never accepted from a caller, bound to exactly one tenant under a write-time constraint, re-bindable by its own tenant, released on deletion, and never usable if it fails validation or encoding |
| **Identity-aware gateway** | **P1–P3, P5, P6, N1, N4–N20, N30–N35, N41** pass, plus **P7, N3, N26, N27** jointly with this service and **P4** jointly with Grafana; run against a deployed gateway in front of a real backend ([V2](#72-required-tests)) in every environment with tenant access ([V3](#72-required-tests)); the read surface is an enumerated allowlist; failures are externally indistinguishable |
| **Platform observability** | **P8, N21, N22, N28, N29, N36–N38, N40** pass, plus **P10** jointly with agent deployment: native tenancy enabled with multi-partition reads, query and fairness limits in place; the backend unreachable from a tenant-reachable network position in **every** environment; unattributed or conflicting lines land in the platform partition, never a tenant one; no write path can place a line in a tenant partition it does not own; existing direct-push producers keep succeeding through the cutover; platform cross-tenant visibility retained |
| **Agent deployment** | **P10** passes jointly with platform observability: log output is structured, carries the log identifier as a discrete field populated by the runtime and not from request data, the field name is confirmed against real output rather than assumed, and a line emitted for a tenant is demonstrably readable **by that tenant** — no routing depends on pattern matching unstructured text |
| **Platform Grafana** | **P4** passes jointly with the gateway: one instance, one org, one shared datasource, no tenant identity in any datasource field or URL; dashboards generic with no tenant variable; two tenants on the same dashboard each see only their own data |

### 9.3 The end-to-end check

Component-level acceptance is necessary and not sufficient — each owner can pass their own
criteria while the seam between two of them leaks. Before tenants are granted access, one
cross-team verification **MUST** be performed and recorded:

Two real service tenants, each with a configured connector, each generating both service and
agent activity. For each tenant, using a real token through the real chain: they see both of
their own log sources, and neither sees any line belonging to the other — through a dashboard,
through ad-hoc query, and through label enumeration. Live tail is verified according to whichever
branch of [Rule G10](#64-live-tail-is-not-compatible-with-a-multi-partition-scope) was adopted:
under the default it must return the generic denial; where fan-in was implemented, each tenant
sees its own sources and no other's. Then the adversarial set against the deployed chain:
spoofed partition header, wrong audience, missing scope, a LogQL query naming the other tenant
with a canary line in place, and an attempt to bind the other tenant's agent identifier.

This is the only check that exercises the mapping, the token, the gateway, and the storage
partition together, and it is the one that would catch the failures each team's own tests are
structurally unable to see.

---

## 10. Amending this contract

Changing a **MUST** or **MUST NOT** here changes a security boundary that several teams have
built against and reviewed as a whole. Such a change requires the same agreement as the
original: the owners in [8.1](#81-who-owns-what), and a security review where the boundary
itself moves.

Two changes in particular are not amendments but new contracts, because their threat models
differ from this one rather than extend it: exposing metrics or traces to tenants
([1.3](#13-logs-only--metrics-and-traces-are-excluded)), and issuing a token authorizing more
than one service tenant ([T4](#32-claims)).

Adding a new agent type is explicitly **not** an amendment. The contract is written against
identifier roles rather than a particular agent's identifier names, so a new connector type
supplying its own log identifier is already covered
([M8](#43-agent-agnostic-by-construction), [M9](#43-agent-agnostic-by-construction)).

---

## Appendix A: rule index

Every rule in this contract, with the subject it governs and where it is stated.

**This index is navigation, not the contract.** The entries below name what each rule is about;
they do not restate it. Where an entry and the rule itself appear to differ, the rule governs.

### T — the token ([section 3](#3-the-token-contract))

| Rule | Subject | Where |
|---|---|---|
| T1 | Signature, issuer, expiry and audience validated before anything else | [3.1](#31-shape-and-validation) |
| T2 | No substitute credential accepted | [3.1](#31-shape-and-validation) |
| T3 | Tenant identity from the `tenant_id` claim only | [3.2](#32-claims) |
| T4 | One service tenant per token | [3.2](#32-claims) |
| T5 | Log-read scope required, not just authentication | [3.3](#33-authorization) |
| T6 | Scope expansion matches the API's | [3.3](#33-authorization) |
| T7 | Authorization evaluated per request | [3.3](#33-authorization) |
| T8 | Log gateway resource audience | [3.4](#34-audience-separation) |
| T9 | API-audience token rejected at the gateway | [3.4](#34-audience-separation) |
| T10 | Expected audience configured, never derived from the request | [3.4](#34-audience-separation) |
| T11 | No platform-admin bypass on this path | [3.5](#35-platform-admin-is-not-a-bypass) |
| T12 | Exactly one audience per token | [3.4](#34-audience-separation) |
| T13 | TLS on every token-bearing hop | [3.6](#36-transport) |

### M — mapping a tenant to its agent log identifier ([section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier))

| Rule | Subject | Where |
|---|---|---|
| M1 | Identifier originates from a trusted agent | [4.1](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful) |
| M2 | One identifier belongs to exactly one tenant, enforced at write | [4.1](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful) |
| M3 | Uniqueness without plaintext storage or reverse lookup | [4.1](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful) |
| M4 | Resolved from the requesting tenant's own connector records | [4.2](#42-provenance-at-query-time) |
| M5 | No cross-tenant scan, join, or reverse lookup | [4.2](#42-provenance-at-query-time) |
| M6 | No dedicated lookup schema | [4.2](#42-provenance-at-query-time) |
| M7 | The identifier is not a secret | [4.2](#42-provenance-at-query-time) |
| M8 | Resolution expressed per connector type | [4.3](#43-agent-agnostic-by-construction) |
| M9 | Identifier treated as opaque, but still validated | [4.3](#43-agent-agnostic-by-construction) |
| M10 | Refreshed on credential rotation | [4.4](#44-freshness) |
| M11 | Bounded cache, maximum staleness | [4.4](#44-freshness) |
| M12 | Cache keyed by service tenant, never by identifier | [4.4](#44-freshness) |
| M13 | Invalidation is an optimisation, not a correctness mechanism | [4.4](#44-freshness) |
| M14 | Resolution fails closed | [4.5](#45-failure-behaviour) |
| M15 | Failures externally indistinguishable from one another | [4.5](#45-failure-behaviour) |
| M16 | Scope is all of the tenant's resolved identifiers, no tie-break | [4.6](#46-multiple-connectors-are-not-ambiguous) |
| M17 | Partition count bounded; denied rather than truncated | [4.6](#46-multiple-connectors-are-not-ambiguous) |
| M18 | Identifier is system-populated, never caller-supplied | [4.7](#47-the-binding-is-system-owned-not-tenant-supplied) |
| M19 | Rotation must not silently orphan a binding | [4.7](#47-the-binding-is-system-owned-not-tenant-supplied) |
| M20 | Binding released on connector deletion or tenant deactivation | [4.7](#47-the-binding-is-system-owned-not-tenant-supplied) |

### L — storage-layer tenancy ([section 5](#5-storage-layer-tenancy))

| Rule | Subject | Where |
|---|---|---|
| L1 | Native multi-tenancy is the boundary | [5.1](#51-isolation-lives-in-the-storage-layer) |
| L2 | No isolation may rest on the shape of a query | [5.1](#51-isolation-lives-in-the-storage-layer) |
| L3 | Partition assigned at ingestion, from the line itself | [5.2](#52-partitioning-happens-at-ingestion) |
| L4 | Unattributed lines go to the platform partition | [5.2](#52-partitioning-happens-at-ingestion) |
| L5 | Structured agent output; no pattern matching unstructured text | [5.2](#52-partitioning-happens-at-ingestion) |
| L6 | Routing field owned by trusted logging infrastructure | [5.3](#53-the-routing-field-must-be-trusted-not-merely-structured) |
| L7 | Conflicting or duplicated routing values go to the platform partition | [5.3](#53-the-routing-field-must-be-trusted-not-merely-structured) |
| L8 | Partition keys derived, charset-constrained, domain-separated | [5.4](#54-partition-keys-must-be-derived-not-passed-through) |
| L9 | Same derivation applied by ingestion and the gateway | [5.4](#54-partition-keys-must-be-derived-not-passed-through) |
| L10 | Global query limits in place before exposure | [5.5](#55-preconditions-for-exposing-query-access) |
| L11 | Per-partition rate and concurrency controls, stated fairness target | [5.5](#55-preconditions-for-exposing-query-access) |
| L12 | Backend reachable only through the gateway, in every environment | [5.5](#55-preconditions-for-exposing-query-access) |

### G — the gateway header contract ([section 6](#6-the-gateway-header-contract))

| Rule | Subject | Where |
|---|---|---|
| G1 | Header computed from the validated token and the resolution | [6.1](#61-the-header-is-computed-never-conveyed) |
| G2 | Inbound partition header unconditionally overwritten | [6.1](#61-the-header-is-computed-never-conveyed) |
| G3 | Scope is exactly the tenant's own partitions | [6.1](#61-the-header-is-computed-never-conveyed) |
| G4 | `Authorization` stripped before forwarding | [6.1](#61-the-header-is-computed-never-conveyed) |
| G5 | The gateway does not parse, rewrite or inject into the query | [6.2](#62-the-gateway-does-not-read-the-query) |
| G6 | Contract applies to every route, not just query endpoints | [6.3](#63-complete-coverage-of-the-read-surface) |
| G7 | Route handling is an allowlist | [6.3](#63-complete-coverage-of-the-read-surface) |
| G8 | Generic, identical denial for unknown routes | [6.3](#63-complete-coverage-of-the-read-surface) |
| G9 | No read path to the backend that bypasses the gateway | [6.3](#63-complete-coverage-of-the-read-surface) |
| G10 | Live tail either excluded or fanned in | [6.4](#64-live-tail-is-not-compatible-with-a-multi-partition-scope) |
| G11 | Exclusion is the default; fan-in carries stated obligations | [6.4](#64-live-tail-is-not-compatible-with-a-multi-partition-scope) |

### S — tenant selection is never an input ([section 7](#7-tenant-selection-is-never-an-input))

| Rule | Subject | Where |
|---|---|---|
| S1 | Scope derived solely from the token and the resolution | [7](#7-tenant-selection-is-never-an-input) |
| S2 | A single shared Grafana datasource | [7](#7-tenant-selection-is-never-an-input) |
| S3 | Generic dashboards, no tenant selector | [7](#7-tenant-selection-is-never-an-input) |
| S4 | Tenant-selecting input on a real route neutralised silently | [7](#7-tenant-selection-is-never-an-input) |
| S5 | Tenant-selecting path gets the generic route denial | [7](#7-tenant-selection-is-never-an-input) |
| S6 | Every such attempt recorded for the operator | [7](#7-tenant-selection-is-never-an-input) |

### V — how the tests must be written ([7.2](#72-required-tests))

| Rule | Subject | Where |
|---|---|---|
| V1 | N14 asserts no B-owned canary, not zero rows | [7.2](#72-required-tests) |
| V2 | Adversarial tests run against the deployed boundary | [7.2](#72-required-tests) |
| V3 | Isolation tests run in every environment with tenant access | [7.2](#72-required-tests) |

---

## Appendix B: remaining threat model rows

Continues [7.1](#71-threat-model), with the same adversary and the same numbering: an attacker
holding a **valid token for tenant A**, attempting to read tenant B. These are the standard
token, header and route attacks. The rows specific to this design — where a caller influences
data rather than the query — are in [7.1](#71-threat-model).

| # | Attack | Control | Outcome |
|---|---|---|---|
| 1 | Edit a dashboard query or variable to name tenant B | Scope comes from the token; the query is not consulted ([G5](#62-the-gateway-does-not-read-the-query)) | Tenant A's data |
| 2 | Bypass the UI — Explore, the datasource query API, or curl | Same control; the UI was never the boundary ([2.2](#22-grafana-orgs-are-not-an-isolation-boundary-here)) | Tenant A's data |
| 3 | Send `X-Scope-OrgID: B` | Unconditionally overwritten ([G2](#61-the-header-is-computed-never-conveyed)) | Tenant A's data |
| 4 | Send `X-Scope-OrgID: A\|B` to append a partition | Overwritten, not merged ([G2](#61-the-header-is-computed-never-conveyed)) | Tenant A's data |
| 5 | Reach the storage backend directly with a chosen header | Backend unreachable except via the gateway, in every environment ([L12](#55-preconditions-for-exposing-query-access)) | No route |
| 6 | Reuse an API token for log queries | Audience rejected ([T9](#34-audience-separation)) | `401` |
| 7 | Use a log token against the API | API guard accepts only the API audience | `401` |
| 8 | Obtain a token bearing **both** audiences | Single-audience issuance is an invariant, enforced on both validators ([T12](#34-audience-separation)) | `401` |
| 9 | Authenticate without the log-read scope | Authorization is required, not just authentication ([T5](#33-authorization)) | `403` |
| 10 | Craft or alter a token | Signature, issuer and expiry validated against our JWKS ([T1](#31-shape-and-validation)) | `401` |
| 11 | Replay another user's token | Bounded lifetime, TLS on every token-bearing hop ([T13](#36-transport)), single audience; the token still scopes to *its own* tenant | No cross-tenant gain |
| 12 | Capture a token from a plaintext hop | No plaintext token-bearing hop exists ([T13](#36-transport)) | No capture |
| 17 | Enumerate via label or series endpoints instead of queries | Whole read surface covered by allowlist ([G6](#63-complete-coverage-of-the-read-surface), [G7](#63-complete-coverage-of-the-read-surface)) | Tenant A's label space |
| 18 | Open a live-tail stream to escape header injection | Tail is excluded from the allowlist, or fanned in per partition under explicit limits ([G10](#64-live-tail-is-not-compatible-with-a-multi-partition-scope), [G11](#64-live-tail-is-not-compatible-with-a-multi-partition-scope)) | Denied, or tenant A's data |
| 19 | Hold a tail stream open past token expiry | Re-authorization required on any fan-in implementation ([G11](#64-live-tail-is-not-compatible-with-a-multi-partition-scope)) | Stream closed |
| 20 | Guess a per-tenant datasource or gateway URL | No such URL exists; unenumerated routes get a generic denial ([S5](#7-tenant-selection-is-never-an-input), [G8](#63-complete-coverage-of-the-read-surface)) | Generic denial |
| 21 | Present a token with no `tenant_id`, or two | Rejected, no unscoped mode ([T3](#32-claims), [T4](#32-claims)) | `401` |
| 22 | Claim platform-admin for a cross-tenant read | No role bypass on this path ([T11](#35-platform-admin-is-not-a-bypass)) | Tenant A's data |
| 23 | Trigger a resolution failure hoping for a permissive fallback | Fail closed; no widening, no stale fallback ([M14](#45-failure-behaviour)) | Generic denial |
| 24 | Probe failure responses to learn about other tenants or connectors | All resolution failures are externally indistinguishable ([M15](#45-failure-behaviour)) | No signal |
| 25 | Keep using a revoked binding after rotation | Bounded staleness holds even if invalidation is never delivered ([M11](#44-freshness), [M13](#44-freshness)) | Expires within the bound |
| 26 | Spoof `Host` or forwarded headers to satisfy the audience check | Expected audience is configured, never derived from the request ([T10](#34-audience-separation)) | `401` |
| 27 | Exhaust the backend with one unbounded query | Global query limits precede exposure ([L10](#55-preconditions-for-exposing-query-access)) | Limited |
| 28 | Exhaust the backend with **many individually valid** queries | Per-partition rate, concurrency and timeout controls with a stated fairness target ([L11](#55-preconditions-for-exposing-query-access)) | Other tenants within target |
| 29 | Read via the write path | Write path is separate and not readable ([G9](#63-complete-coverage-of-the-read-surface)) | No route |
