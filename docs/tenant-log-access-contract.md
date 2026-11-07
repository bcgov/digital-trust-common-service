# Tenant Log Access and Isolation Contract

Status: Normative. This document defines the contract; it does not implement it.

This is the specification for how a service tenant reads its own logs through the tenant-facing
Grafana instance. Every component in the chain — the gateway, the tenant Grafana instance, Loki,
Alloy, the agent log configuration, and the write-path nginx — implements against this document.
Where this document and [tenant-observability-design.md](./tenant-observability-design.md)
disagree, this document wins.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used as
defined in RFC 2119. Rule numbers (`T1`–`T13`, `M1`–`M20`, `L1`–`L12`, `G1`–`G10`, `S1`–`S4`,
`V1`–`V3`) are permanent IDs cited in code and tests; retired numbers are never reused, so numbers
may appear out of order.

## 1. Purpose and scope

### 1.1 What this contract covers

A service tenant must be able to read the log lines produced on its behalf by this service and by
its credential agent. It must not be able to read any other service tenant's lines, and the
platform team does not broker the request.

This contract defines:

- the token a caller presents, its claims, its OAuth scope, and its resource audience;
- how a service tenant is mapped to its agent log identifier;
- how Alloy routes log lines into Loki partitions and how the gateway builds the partition set header;
- the rule that tenant selection is never an input;
- the required tests and the component ownership table.

### 1.2 How it works

```text
Browser ──(Bearer token)──► Tenant Grafana ──(Bearer token)──► Gateway (Envoy)
                                                                  │
                                                  ext_authz check │ (Authorization header)
                                                                  ▼
                                                          Decision endpoint
                                                       (validates token & OAuth scope,
                                                        resolves active connectors)
                                                                  │
                                                                  ▼
                                     Loki ◄──(X-Scope-OrgID)── Gateway
```

A worked request from browser to Loki:

1. A user or machine client for service tenant `3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13` presents a
   token carrying `tenant_id: "3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13"`, OAuth scope `logs:read`,
   and `aud: "https://logs.example.gov.bc.ca"`.
2. Tenant Grafana forwards the request and the `Authorization: Bearer ...` header to the gateway on
   an allowlisted Loki read path such as `GET /loki/api/v1/query_range`.
3. The gateway calls the decision endpoint on this service's internal listener.
4. The decision endpoint validates the token, finds one active `traction` connector with
   `agentLogId` `8a11d0e4-12bc-4a91-b501-99e01d2c3f44`, and returns `200` with
   `X-Scope-OrgID: t-3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13|a-traction-8a11d0e4-12bc-4a91-b501-99e01d2c3f44`.
5. The gateway overwrites any inbound `X-Scope-OrgID`, replaces the caller's `Authorization`
   header with its own Loki credentials, and forwards the request to Loki.
6. Loki reads only the two partitions in that partition set and returns the matching log lines.

### 1.3 What this contract does not cover

This contract specifies requirements, not internal component configuration. The implementing
repositories are listed in [section 8](#8-where-the-work-lands), and each component is accepted
under [section 9](#9-acceptance-and-closure). It covers the write path only where ingestion rules
are needed to keep the read path safe.

### 1.4 Logs only — metrics and traces are excluded

The tenant-facing observability surface is logs only. Metrics and traces stay platform-admin-only:

- Metric series do not carry `tenant_id` or any other high-cardinality tenant label, so the metric
  store has no tenant partition to query.
- Trace ingestion has no per-span routing equivalent to Alloy's per-line log routing, and the
  credential agent is not trace-instrumented.
- Traces and metrics carry cross-tenant aggregates and internal topology intended for platform
  operators.

Spans still carry `tenant_id` as an attribute for operator debugging, which confers no tenant
access. Exposing metrics or traces to service tenants would require a new contract
([section 10](#10-amending-this-contract)).

### 1.5 Relationship to the tenant audit log

The tenant audit log is a separate API surface served by this service with its own OAuth scope
(`audit:read`). The audit log records durable organizational actions; Loki log access shows
operational telemetry from request execution. Neither OAuth scope implies the other.

## 2. What "tenant" means in each service

Four systems in this chain use the word "tenant" for different things. This contract uses the
specific terms below instead of the bare word "tenant":

- `service tenant`: A customer organization in this service, identified by `tenant_id` (a UUID we
  generate and emit on our own log lines).
- `agent log identifier`: The identifier the credential agent stamps on each log line it emits for
  a sub-wallet (`wallet_id` in Traction/ACA-Py today).
- `partition`: A single Loki storage tenant (`t-<tenant_id>`, `a-<type>-<agent_log_id>`, or the
  platform partition `dt-services`).
- `partition set`: The pipe-joined list of Loki partitions placed in `X-Scope-OrgID` for a
  request.
- `OAuth scope`: A permission string in the access token's `scope` claim (such as `logs:read` or
  `tenants:admin`).
- `gateway`: The identity-aware Envoy proxy in front of Loki.
- `decision endpoint`: This service's internal `ext_authz` endpoint that validates the token and
  computes the `X-Scope-OrgID` partition set.

| Term | System | Identifier | Role in log access |
|---|---|---|---|
| Service tenant | This service | `tenant_id` UUID | Sole source of tenant identity in the token; emitted on our log lines. |
| Agent sub-tenant | Credential agent | Two distinct UUIDs (see [2.1](#21-the-agent-sub-tenant-has-two-identifiers-and-they-are-not-interchangeable)) | The agent stamps `wallet_id` on its log lines. |
| Partition | Loki | String in `X-Scope-OrgID` | Storage isolation unit enforced by Loki. |
| Grafana org | Tenant Grafana | Single shared numeric org ID | UI grouping only; shared by all service tenants ([2.2](#22-grafana-orgs-are-not-an-isolation-boundary-here)). |

### 2.1 The agent sub-tenant has two identifiers, and they are not interchangeable

| Identifier | Purpose | Source | On agent log lines? |
|---|---|---|---|
| Agent API sub-tenant ID | Addressing the agent's API when requesting a sub-wallet bearer token | Stored with the connector's credentials when configured | Sometimes logged as `tenant_id` by Traction; never used for routing |
| Agent log identifier (`wallet_id` today) | Identifying which sub-wallet emitted an agent log line | Decoded from the bearer token returned by the agent's tenant-token endpoint | Yes, stamped as `wallet_id` on every record |

Both identify the same sub-wallet, but their values are different UUIDs. Only the agent log
identifier (`wallet_id`) is bound by this service and used to route or query agent logs:

- The agent log identifier is a claim in the bearer token the connector already obtains from the
  agent's tenant-token endpoint.
- That token carries no wallet key material on the credential path. The agent log identifier is
  not a secret, though the token carrying it is.
- ACA-Py stamps `wallet_id` on structured JSON log lines while the Traction plugin may also stamp
  its API sub-tenant ID as `tenant_id`. Alloy routes exclusively on `wallet_id` and ignores
  `tenant_id` on agent log lines.

### 2.2 Grafana orgs are not an isolation boundary here

All tenant users share one org on the tenant-facing Grafana instance. Any authenticated user can
send arbitrary queries through Explore, the datasource API, or an HTTP client. Grafana roles and
dashboard permissions restrict only the UI and **MUST NOT** be relied upon as security controls.
Isolation is enforced by the token, the gateway, the decision endpoint, and the Loki partition.

### 2.3 Upstream identity is not tenant identity

Users authenticate through an upstream identity provider, but the upstream provider has no concept
of a service tenant and **MUST NOT** be given one for log access. No upstream group, role, or
claim participates in tenant scoping. Upstream authentication establishes who the user is; this
service resolves which service tenant they act for and puts `tenant_id` in the token it mints.

## 3. The token contract

### 3.1 Shape and validation

<a id="t1"></a>
**T1: Token signature, issuer, expiry, and audience validation**
Owner: This service (issuance), Gateway (verification). Checked by: [N5](#72-required-tests).
The caller presents an RS256 access token issued by this service and validated against this
service's JWKS. The decision endpoint **MUST** verify the signature, issuer, expiry, and audience
before anything else, and **MUST** fail closed on any failure.
Why: Uses the same cryptographic check as the API so neither path is a weaker entry point.

<a id="t2"></a>
**T2: No substitute credentials**
Owner: Gateway. Checked by: [N6](#72-required-tests).
The gateway and decision endpoint **MUST NOT** accept any credential other than a bearer token
issued by this service: not an upstream token, an agent token, a shared secret, basic auth, or a
session cookie.
Why: Prevents alternative authentication mechanisms from bypassing token claim checks.

### 3.2 Claims

| Claim | Required | Role in this contract |
|---|---|---|
| `tenant_id` | Yes | The service tenant the caller acts for; the sole source of tenant identity. |
| `scope` | Yes | Space-delimited granted OAuth scopes carrying log-read authorization. |
| `aud` | Yes | The resource audience this token was minted for. |
| `iss` | Yes | This service's OIDC issuer. |
| `exp`, `iat` | Yes | Validity window. |
| `sub` | Yes | Authenticated subject, used for attribution and support only. |
| `client_id` | Machine clients | Client identifier, used for attribution and support only. |
| `roles` | No | Omitted for machine clients with no roles; its absence **MUST NOT** fail authentication. |

<a id="t3"></a>
**T3: Tenant identity from `tenant_id` only**
Owner: This service (issuance), Gateway (verification). Checked by: [P1](#72-required-tests), [P2](#72-required-tests), [N7](#72-required-tests).
Service tenant identity **MUST** be taken from the `tenant_id` claim of the validated token and
from nowhere else. A token with no `tenant_id`, an empty `tenant_id`, or more than one `tenant_id`
value **MUST** be rejected with no fallback or unscoped mode.
Why: Guarantees that every authorized request is tied to one verified service tenant.

<a id="t4"></a>
**T4: Single service tenant per token**
Owner: This service, Gateway. Checked by: [N7](#72-required-tests).
Same single-tenant requirement as T3; multi-tenant tokens are outside this contract and require a
new contract ([section 10](#10-amending-this-contract)).
Why: Preserves the `T4` rule identifier cited by token validation tests.

### 3.3 Authorization

<a id="t5"></a>
**T5: Required `logs:read` OAuth scope**
Owner: Gateway. Checked by: [P1](#72-required-tests), [N4](#72-required-tests).
The decision endpoint **MUST** require the `logs:read` OAuth scope and **MUST** fail closed with
`403` when it is absent.
Why: Authentication alone does not authorize a caller to read operational logs.

<a id="t6"></a>
**T6: OAuth scope expansion matches the API**
Owner: This service (definition), Gateway (enforcement). Checked by: [P3](#72-required-tests).
The OAuth scope check **MUST** apply the same scope expansion as the API, where `tenants:admin`
grants every Level 2 and Level 3 OAuth scope including `logs:read`.
Why: Prevents the gateway and API from disagreeing on what `tenants:admin` authorizes.

<a id="t7"></a>
**T7: Per-request authorization**
Owner: Gateway. Checked by: [N9](#72-required-tests).
Authorization **MUST** be evaluated on every request from the presented token. The gateway **MUST
NOT** cache an authorization decision across tokens or subjects.
Why: Stops a shared connection from reusing a previous caller's partition set.

### 3.4 Audience separation

<a id="t8"></a>
**T8: Dedicated log gateway audience**
Owner: This service. Checked by: [N2](#72-required-tests).
A token used for log queries **MUST** carry the gateway's resource audience (requested via RFC 8707)
and **MUST NOT** carry the API audience.
Why: Separates log-reading tokens from API tokens so neither can be replayed against the other.

<a id="t9"></a>
**T9: API-audience tokens rejected at the gateway**
Owner: Gateway, This service. Checked by: [N1](#72-required-tests), [N2](#72-required-tests).
The decision endpoint **MUST** reject a token whose `aud` is the API audience, even if the token is
otherwise valid and carries `logs:read`; conversely, the API rejects gateway-audience tokens.
Why: Ensures a widely distributed API token cannot be used to read logs.

<a id="t10"></a>
**T10: Explicitly configured expected audience**
Owner: Gateway. Checked by: [N35](#72-required-tests).
The gateway's expected audience **MUST** be configured explicitly and **MUST NOT** be derived from
the request URL, `Host` header, or forwarded headers.
Why: Deriving the expected audience from request headers would let a caller satisfy the check
itself.

<a id="t12"></a>
**T12: Single audience per token**
Owner: This service, Gateway. Checked by: [N3](#72-required-tests).
A token **MUST** carry exactly one audience value, and both this service and the decision endpoint
**MUST** enforce single-audience tokens by rejecting any token whose `aud` contains multiple
values.
Why: Standard JWT audience checks test array membership, so a multi-audience token would satisfy
both validators and defeat T8 and T9.

### 3.5 Platform admin is not a bypass

<a id="t11"></a>
**T11: No role-based bypass on the tenant path**
Owner: Gateway. Checked by: [N8](#72-required-tests).
The decision endpoint **MUST NOT** implement a role-based bypass of tenant scoping; a token
carrying the platform-admin role is scoped to its own `tenant_id` like any other token.
Why: Platform operators read cross-tenant logs through the separate platform Grafana, keeping
cross-tenant access code out of the tenant gateway.

### 3.6 Transport

<a id="t13"></a>
**T13: TLS on every token-bearing hop**
Owner: Log storage, Gateway. Checked by: [N22](#72-required-tests).
Every hop that carries a bearer token — browser to Tenant Grafana, Tenant Grafana to gateway, and
gateway to decision endpoint — **MUST** use TLS. A plaintext hop carrying a bearer token **MUST
NOT** exist in any environment, and external plaintext requests **MUST** be refused or redirected.
Why: Prevents passive capture of bearer tokens in transit.

## 4. Mapping a service tenant to its agent log identifier

To show a service tenant the log lines its credential agent produced on its behalf, the decision
endpoint resolves the service tenant to its agent log identifiers ([2.1](#21-the-agent-sub-tenant-has-two-identifiers-and-they-are-not-interchangeable)).

### 4.1 Provenance — the identifier must be trustworthy before it is useful

The agent log identifier unlocks a partition of log lines, so it **MUST NOT** be a value the
requesting service tenant can choose. Because a service tenant configures its own connector URL, an
identifier read from an unverified token returned by a tenant-nominated URL is tenant-asserted
unless the endpoint itself is trusted.

<a id="m1"></a>
**M1: Identifier originates from a trusted agent**
Owner: This service. Checked by: [N25](#72-required-tests).
The agent log identifier **MUST** originate from an agent endpoint the platform trusts
independently of the request (such as an allowlist of trusted agent endpoints). An identifier from
an untrusted endpoint **MUST NOT** be used for log partitioning, and checking the `iss` string of
an unverified agent token **MUST NOT** be treated as sufficient unless its signature is verified
against a platform-held key.
Why: Prevents a service tenant from pointing a connector at an attacker-run server that asserts
another tenant's `wallet_id`.

<a id="m2"></a>
**M2: One service tenant per agent log identifier**
Owner: This service. Checked by: [P9](#72-required-tests), [P11](#72-required-tests), [N23](#72-required-tests), [N24](#72-required-tests).
Each agent log identifier **MUST** belong to at most one service tenant, enforced atomically at
write time so a second service tenant cannot bind it concurrently or later. Binding **MUST** fail
rather than displace another service tenant's binding, while re-binding by the service tenant that
already holds it **MUST** succeed.
Why: Prevents two service tenants from sharing an agent partition while allowing the owning tenant
to rotate or recreate its connector.

Enforcing M2 does not require storing the agent log identifier as queryable plaintext. A
non-reversible keyed hash of the connector type and identifier, held under a uniqueness constraint,
blocks double-binding without creating a reverse lookup from identifier to service tenant.

### 4.2 Provenance at query time

<a id="m4"></a>
**M4: Resolved from the requesting tenant's own connector records**
Owner: This service. Checked by: [P1](#72-required-tests), [P5](#72-required-tests).
The agent log identifier **MUST** be resolved from the requesting service tenant's own connector
records, queried by that tenant's `tenant_id`.
Why: Ensures resolution always starts from the authenticated `tenant_id` in the token.

<a id="m5"></a>
**M5: No cross-tenant scan, join, or reverse lookup**
Owner: This service. Checked by: [P1](#72-required-tests), [N23](#72-required-tests).
Resolution **MUST NOT** scan, join, or search across other service tenants' connector records,
**MUST NOT** consult any global index or lookup keyed by the agent log identifier, and **MUST NOT**
store the identifier in a form that creates a reverse lookup to a service tenant.
Why: Keeps every lookup strictly forward (`tenant_id` → identifiers) so a query can never ask
whose identifier a value is.

No dedicated lookup schema is needed: the agent log identifier is stored inside the connector's
encrypted credential payload alongside its other per-connector-type fields, paired with the derived
uniqueness hash from M2. Because the identifier is emitted in plaintext on every agent log line,
this contract adds no extra at-rest confidentiality requirement beyond keeping it non-disclosable
to other service tenants (M15).

### 4.3 Agent-agnostic by construction

<a id="m8"></a>
**M8: Resolution expressed per connector type**
Owner: This service. Checked by: [P5](#72-required-tests).
Resolution **MUST** be keyed by connector type rather than hardcoded to a single agent
implementation.
Why: Allows future credential agent types to supply their own log identifier without a schema
migration or contract change.

<a id="m9"></a>
**M9: Identifier treated as opaque and validated before use**
Owner: Gateway. Checked by: [N26](#72-required-tests).
The decision endpoint **MUST NOT** assume the semantic meaning of an agent log identifier, but it
**MUST** validate and encode the identifier as a partition key under [L8](#54-partition-keys-must-be-derived-not-passed-through)
before placing it in `X-Scope-OrgID`.
Why: Keeps the gateway independent of agent internals while preventing header or path injection.

### 4.4 Freshness

<a id="m10"></a>
**M10: Refreshed on credential rotation**
Owner: This service. Checked by: [P7](#72-required-tests), [P11](#72-required-tests).
The resolved agent log identifier **MUST** be updated when a service tenant's connector credentials
are rotated or replaced.
Why: A re-provisioned connector may point to a new sub-wallet with a new identifier.

<a id="m11"></a>
**M11: Bounded cache with five-minute maximum staleness**
Owner: Gateway. Checked by: [P7](#72-required-tests), [N34](#72-required-tests).
Any partition-resolution cache **MUST** be bounded in size and **MUST** have a maximum TTL of five
minutes, which **MUST** hold even if no invalidation signal is delivered.
Why: Bounds how long a rotated or revoked binding remains active if cache invalidation fails.

<a id="m12"></a>
**M12: Cache keyed by service tenant and invalidated on change**
Owner: Gateway. Checked by: [P1](#72-required-tests), [N34](#72-required-tests).
Cache entries **MUST** be keyed by `tenant_id`, **MUST** be invalidated when a connector changes,
and **MUST NOT** be keyed or retrievable by agent log identifier.
Why: Prevents a reverse lookup at the cache layer and drops stale bindings immediately on
in-process updates.

### 4.5 Failure behaviour

<a id="m14"></a>
**M14: Resolution fails closed**
Owner: Gateway. Checked by: [P2](#72-required-tests), [N30](#72-required-tests), [N31](#72-required-tests).
Partition resolution **MUST** fail closed according to the table below and **MUST NOT** widen the
partition set, fall back to a default, or degrade to service-only logs when a datastore,
decryption, or validation error occurs.
Why: Treating an infrastructure or validation failure as "no connectors" would silently hide agent
logs or mask an isolation fault.

| Case | Meaning | Required behaviour |
|---|---|---|
| No connector configured | Service tenant has not onboarded an agent | Serve `t-<tenant_id>` only (not an error). |
| Connector has no `agentLogId` | Configured before capture or omitted by agent | Omit that connector's partition, serve `t-<tenant_id>`, and log an operator warning. |
| Connector is inactive | Deactivated connector or tenant | Treat as absent; **MUST NOT** resolve its identifier. |
| Identifier fails validation | Unusable as a partition key ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | Deny the entire request (`403`). |
| Resolution error | Database error, decryption error, or bad payload shape | Deny the entire request (`403`); **MUST NOT** degrade to `t-<tenant_id>` only. |

<a id="m15"></a>
**M15: Externally indistinguishable resolution failures**
Owner: Gateway. Checked by: [N32](#72-required-tests), [N33](#72-required-tests).
All resolution denials (validation failure or resolution error) **MUST** return the same HTTP
status code (`403`) and generic body, and **MUST NOT** disclose whether another service tenant
exists, how many connectors it has, or any agent log identifier.
Why: Prevents callers from probing error responses as an oracle for other tenants' state.

### 4.6 Multiple connectors are not ambiguous

<a id="m16"></a>
**M16: Partition set includes all active connectors**
Owner: Gateway. Checked by: [P5](#72-required-tests).
The resolved partition set **MUST** include the agent partitions of all active connectors belonging
to the requesting service tenant that carry an identifier, and **MUST NOT** apply an implicit
tie-break.
Why: Every active connector belongs to the service tenant, so picking one would hide part of the
tenant's own logs.

<a id="m17"></a>
**M17: Maximum of ten partitions per partition set**
Owner: Gateway. Checked by: [N41](#72-required-tests).
A single partition set **MUST** contain at most ten partitions (one service partition plus up to
nine agent partitions), and a service tenant exceeding ten partitions **MUST** be denied (`403`)
rather than silently truncated.
Why: Bounds per-query fan-out in Loki and enables the per-partition concurrency cap in [L11](#55-preconditions-for-exposing-query-access).

### 4.7 The binding is system-owned, not tenant-supplied

<a id="m18"></a>
**M18: Identifier is system-populated, never caller-supplied**
Owner: This service. Checked by: [N39](#72-required-tests).
The agent log identifier **MUST** be populated by this service from the trusted agent. Any
caller-supplied identifier on a tenant-facing connector create or update request **MUST** be
ignored or rejected and **MUST NOT** be persisted or used for partitioning.
Why: Stops a service tenant from typing another tenant's `wallet_id` into its own connector to
read their logs or lock them out under M2.

<a id="m19"></a>
**M19: Credential updates preserve existing bindings**
Owner: This service. Checked by: [P11](#72-required-tests).
Replacing, rotating, or partially updating a connector's credentials **MUST NOT** silently clear or
orphan an established agent log identifier binding.
Why: Prevents routine credential maintenance from silently dropping a tenant's agent log access.

<a id="m20"></a>
**M20: Binding released on connector deletion or deactivation**
Owner: This service. Checked by: [P11](#72-required-tests).
An agent log identifier binding **MUST** be released when the connector holding it is deleted or
the service tenant is deactivated.
Why: Allows a deleted and re-created connector for the same sub-wallet to bind its identifier
again.

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

**The service tenant key.** A service tenant's partition key is a fixed prefix plus its
`tenant_id`, and nothing else:

```text
partition_key = "t-" + tenant_id          e.g.  t-3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13
valid         = ^t-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

- **No stored mapping.** The key is a pure function of the `tenant_id`, so the collector and the
  gateway each compute it independently and cannot disagree about which tenants exist.
- **No collisions by construction.** A `tenant_id` is a UUID, so distinct tenants yield distinct
  keys. The `t-` prefix is the domain separation (L8): it keeps tenant keys out of the namespace
  of agent keys (`a-`, defined below)
  and of the names the write path assigns to direct-push producers.
- **Reserved prefixes.** The write path **MUST NOT** assign any producer an identity beginning
  `t-` or `a-`, since that is what closes the write-into-a-tenant-partition case above.
- **Safe by shape.** 38 bytes, lowercase hex and hyphen only: well inside the 150-byte limit and
  unable to contain `|`, a path character, or a control character.
- **One canonical form.** The `tenant_id` is taken as emitted, lowercase and hyphenated, with no
  case-folding or trimming. A value that does not match the pattern is treated as malformed and
  its line goes to the platform partition ([L7](#53-the-routing-field-must-be-trusted-not-merely-structured)).
  Being strict here leaves one form to agree on, which is what [L9](#54-partition-keys-must-be-derived-not-passed-through)
  needs.

**The agent partition key.** An agent sub-wallet's partition key is the `a-` prefix, the
connector type, and the agent log identifier:

```text
partition_key = "a-" + connector_type + "-" + agent_log_id
                e.g.  a-traction-3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13
valid         = ^a-(traction|credo)-[a-z0-9-]{1,100}$
```

- **Domain-separated across connector types.** Including `connector_type` ensures that even if
  two different agent implementations ever emit the same `agent_log_id`, their partition keys
  cannot collide.
- **Lowercase and strict.** `agent_log_id` must match `^[a-z0-9-]{1,100}$` (for Traction, a
  canonical lowercase UUID matching `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`),
  with no case-folding or trimming. Any value outside that pattern is rejected.

The collector and the gateway **MUST** each be tested against the same fixed vectors, including
an uppercase UUID, one with surrounding whitespace, and one containing `|`, so that L9 is
checked rather than assumed.

### 5.5 Preconditions for exposing query access

**Rule L10.** A global query limits configuration (query length, series, entries, cardinality)
**MUST** be in place before any tenant is granted query access. Arbitrary LogQL from external
callers without limits is a denial-of-service surface against every other tenant sharing the
backend. The limits are global and enforced per partition; per-partition overrides are for
known exceptions only. This rule governs the **shape** of a single query; request volume and
fairness between tenants are [L11](#55-preconditions-for-exposing-query-access)'s.

**Rule L11.** Query-shape limits alone are **not** sufficient for availability isolation: a
caller can stay inside every per-query limit and still exhaust shared scheduler and querier
capacity by volume. Per-partition concurrency (`max_query_parallelism`), queue, and timeout
controls **MUST** be configured in Loki before any tenant is granted query access.

- **Capacity cap.** No service tenant **MUST** hold more than **one third** of total query
  capacity (querier replicas multiplied by per-querier concurrency) across its composed scope.
  Because a tenant's scope may contain up to ten partitions
  ([M17](#46-multiple-connectors-are-not-ambiguous)), Loki's per-partition query parallelism
  **MUST** be set to no more than one third of total query capacity divided by ten, and
  recalculated whenever querier replicas or per-querier concurrency change.
- **Fairness target.** While a competing service tenant continuously saturates its allowance, a
  tenant's reference query at the upper bound of [Rule L10](#55-preconditions-for-exposing-query-access)
  across its composed scope **MUST** complete within **10 seconds at p95** and within **2× its
  uncontended baseline**, with **no increase in error rate** over that baseline and with the
  results cache bypassed. This benchmark **MUST** be run and recorded before tenant exposure and
  whenever querier capacity changes.

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

**Rule G10.** Live tail (`/loki/api/v1/tail`) **MUST** be excluded from the allowlist and **MUST**
receive the same generic denial as any other unenumerated route
([G8](#63-complete-coverage-of-the-read-surface)), for every tenant regardless of partition count;
exposing live tail requires an amendment under [section 10](#10-amending-this-contract).

Loki refuses tail requests that name more than one partition, and allowing tail to succeed only
for single-partition tenants would disclose how many partitions the caller has. Tenants retain
near-real-time viewing through ordinary range queries on a refresh interval.

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
gives the caller no signal to probe against. A tenant-selecting **path** does not exist
([S2](#7-tenant-selection-is-never-an-input)), so a request to one is simply an unenumerated
route and receives the generic denial of [Rule G7](#63-complete-coverage-of-the-read-surface)
and [Rule G8](#63-complete-coverage-of-the-read-surface).

### 7.1 Threat model

The realistic adversary is a legitimate tenant user holding a **valid token for tenant A**,
with full control of their own HTTP client and able to configure their own connector, attempting
to read or write tenant B's logs.

The query path and the write path have opposite properties, and that is the reason this design
was chosen: on the query path, the caller controls the query completely and controls the
partition scope not at all; on the write and binding paths, a caller can influence *data* rather
than the *query*. That is where this design is actually fragile, and it is where most of these
rules sit: the query path is safe by construction, the write path is safe only by discipline.
Each attack and the rule that stops it are tested in [7.2](#72-required-tests).

### 7.2 Required tests

These tests define what "the contract holds" means. They **MUST** exist as automated, gating
tests owned by the component that implements the rule, except for the cases [9.2](#92-accepting-each-component)
assigns to the [9.3](#93-the-end-to-end-check) check or to [L11](#55-preconditions-for-exposing-query-access)'s
reference benchmark, and a component **MUST NOT** be accepted without them. They are specified by
behaviour so the implementing repository writes them against the contract, not against its own
implementation.

**Positive — the intended path works.**

| # | Given | Expect | Component |
|---|---|---|---|
| P1 | Valid token, log-read scope, tenant A, one connector resolving | Query succeeds; scope is exactly A's service partition plus that connector's | Gateway |
| P2 | Tenant A has no connector | Query succeeds; scope is A's service partition only | Gateway |
| P3 | Token carrying only the tenant superuser scope | Allowed — expansion applied ([T6](#33-authorization)) | Gateway |
| P4 | Tenants A and B each open the same generic dashboard | Each sees only their own lines | Grafana + gateway |
| P5 | Tenant A has several active connectors, including of different types | Scope includes **all** of A's resolved partitions, none of B's ([M16](#46-multiple-connectors-are-not-ambiguous)) | Gateway |
| P6 | Label, series and label-values endpoints, valid token | Succeed, constrained to the caller's partitions | Gateway |
| P7 | Connector rotated to a new identifier, **no** invalidation signal delivered | New identifier in effect within the staleness bound ([M11](#44-freshness)) | This service + gateway |
| P8 | Platform operator via the platform path | Full cross-tenant visibility retained | Log storage |
| P9 | An identifier is bound to a tenant for the first time | Binding succeeds and is usable | This service |
| P10 | An agent line emitted for tenant A, carrying A's identifier field | Lands in A's partition and is returned to A's token, and to no other tenant's | Agent deployment + Log storage |
| P11 | Tenant A deletes and re-creates a connector against the same sub-wallet, then rotates its credentials | Binding succeeds both times and A's agent logs stay visible ([M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful), [M19](#47-the-binding-is-system-owned-not-tenant-supplied), [M20](#47-the-binding-is-system-owned-not-tenant-supplied)) | This service |

**Adversarial — each must produce the stated safe outcome.** Some outcomes are a rejection and
some are a correctly scoped success; both are passes. A case that "succeeds" here is not a
weaker result — it is the demonstration that the attack changed nothing.

| # | Given | Expect | Component |
|---|---|---|---|
| N1 | Token with the API audience | `401`; nothing forwarded ([T9](#34-audience-separation)) | Gateway |
| N2 | Log-audience token against the API | `401` ([T8](#34-audience-separation), [T9](#34-audience-separation)) | This service |
| N3 | Signed token whose `aud` contains **both** audiences | `401` from both validators; issuance never produces one ([T12](#34-audience-separation)) | This service + gateway |
| N4 | Valid token without the log-read scope | `403`; nothing forwarded ([T5](#33-authorization)) | Gateway |
| N5 | Expired, unsigned, wrong-issuer, or wrong-key token | `401` ([T1](#31-shape-and-validation)) | Gateway |
| N6 | No token, or a cookie / basic-auth / upstream / agent token instead ([T2](#31-shape-and-validation)) | `401` | Gateway |
| N7 | Token with absent, empty, or repeated `tenant_id` | `401` ([T3](#32-claims), [T4](#32-claims)) | Gateway |
| N8 | Token carrying platform-admin | Scoped to its own tenant; no widening ([T11](#35-platform-admin-is-not-a-bypass)) | Gateway |
| N9 | Sequential requests with tenant A's then tenant B's token on one connection | Each scoped to its own tenant; no decision reuse ([T7](#33-authorization)) | Gateway |
| N10 | Inbound `X-Scope-OrgID: B` | Scoped to A; that value never reaches the backend ([G2](#61-the-header-is-computed-never-conveyed)) | Gateway |
| N11 | Inbound `X-Scope-OrgID: A\|B` | Scoped to A only; no merge ([G2](#61-the-header-is-computed-never-conveyed)) | Gateway |
| N12 | Inbound partition header on a **rejected** request | Rejected, and nothing forwarded carrying it ([G2](#61-the-header-is-computed-never-conveyed)) | Gateway |
| N13 | Forwarded request inspected at the backend | The caller's `Authorization` header is not present; only the gateway's own backend login may be ([G4](#61-the-header-is-computed-never-conveyed)) | Gateway |
| N14 | LogQL explicitly selecting tenant B's labels | Forwarded unchanged, scoped to A only ([G5](#62-the-gateway-does-not-read-the-query)). Against real storage with a **B-owned canary** line present, the canary is **not** returned; A-owned lines that happen to match may be ([V1](#72-required-tests)) | Gateway |
| N15 | Query via Explore / the datasource API / curl, bypassing dashboards | Scoped to A identically ([L2](#51-isolation-lives-in-the-storage-layer), [G5](#62-the-gateway-does-not-read-the-query)) | Gateway |
| N16 | Tenant-selecting parameter or body field on an allowlisted route | Ignored; scoped to A ([S4](#7-tenant-selection-is-never-an-input)) | Gateway |
| N17 | Tenant-selecting **path**, or any unenumerated route | Generic denial, identical for every unknown path ([G7](#63-complete-coverage-of-the-read-surface), [G8](#63-complete-coverage-of-the-read-surface)) | Gateway |
| N18 | A backend read route that exists but is not enumerated | Denied ([G7](#63-complete-coverage-of-the-read-surface)) | Gateway |
| N19 | Label-values request naming another tenant's partition | Scoped to A's label space ([G6](#63-complete-coverage-of-the-read-surface), [G7](#63-complete-coverage-of-the-read-surface)) | Gateway |
| N20 | Live-tail request | Generic denial, identical for every tenant regardless of partition count ([G10](#64-live-tail-is-not-compatible-with-a-multi-partition-scope)) | Gateway |
| N21 | Direct request to the storage backend with a chosen header | Not routable from a tenant-reachable network position, in every environment ([L12](#55-preconditions-for-exposing-query-access)) | Log storage |
| N22 | Plaintext request to any token-bearing hop | Refused or redirected; no token accepted over plaintext ([T13](#36-transport)) | Log storage |
| N23 | Tenant B attempts to bind an identifier already bound to tenant A | Binding **refused**; A's binding unchanged ([M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)) | This service |
| N24 | Two tenants attempt to bind the same identifier concurrently | Exactly one succeeds ([M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)) | This service |
| N25 | Connector pointed at an untrusted endpoint asserting an identifier | Identifier not usable for partitioning ([M1](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful)) | This service |
| N26 | Identifier containing `\|`, a path or control character, or over the length limit | Rejected; never reaches a header ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | This service + gateway |
| N27 | Two different source identifiers deriving to the same partition key | Collision detected, not silently shared ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | This service + gateway |
| N28 | Log line carrying a foreign routing value via request data, user content, or a duplicate JSON key | Routed to the platform partition, never to the named tenant ([L6](#53-the-routing-field-must-be-trusted-not-merely-structured), [L7](#53-the-routing-field-must-be-trusted-not-merely-structured)) | Log storage |
| N29 | Agent line with no extractable identifier | Platform partition; never a tenant partition ([L4](#52-partitioning-happens-at-ingestion)) | Log storage |
| N30 | Connector inactive, or present with no identifier | That partition omitted; service lines still served ([M14](#45-failure-behaviour)) | Gateway |
| N31 | Resolution fails with a backend error | Denied; **not** degraded to partial results ([M14](#45-failure-behaviour)) | Gateway |
| N32 | Responses compared across an unusable identifier and a backend error | Indistinguishable status and body. A tenant with no connector is a **success** and is correctly distinguishable ([M15](#45-failure-behaviour)) | Gateway |
| N33 | Any failure response body inspected | No other tenant's identifier, no connector count, no tenant existence signal ([M15](#45-failure-behaviour)) | Gateway |
| N34 | Identifier rotated; queries issued at the staleness bound and just after | Old binding not honoured past the bound ([M11](#44-freshness)) | Gateway |
| N35 | Spoofed `Host` / forwarded headers matching the gateway audience | `401`; audience unaffected ([T10](#34-audience-separation)) | Gateway |
| N36 | Query exceeding the global limits | Rejected by limits; other tenants unaffected ([L10](#55-preconditions-for-exposing-query-access)) | Log storage |
| N37 | Tenant A floods many individually compliant queries | Tenant B stays within the fairness target and capacity cap, verified by the log-storage fairness benchmark runbook ([L11](#55-preconditions-for-exposing-query-access)) | Log storage |
| N38 | Read attempted through the write path | Not readable ([G9](#63-complete-coverage-of-the-read-surface)) | Log storage |
| N39 | Tenant supplies a log identifier directly in a connector create or update request | Not persisted, not used for partitioning, attempt recorded ([M18](#47-the-binding-is-system-owned-not-tenant-supplied)) | This service |
| N40 | Direct-push credential whose identity derives to a tenant's partition key | Refused; no write into a tenant partition ([L8](#54-partition-keys-must-be-derived-not-passed-through)) | Log storage |
| N41 | Tenant's resolved partition count exceeds the bound | Denied, never silently truncated ([M17](#46-multiple-connectors-are-not-ambiguous)) | Gateway |

**Rule V1.** N14 is the one to read carefully. A query naming another tenant **MUST** return no
line belonging to that tenant, and **MUST NOT** return an error that depends on whether that
tenant exists. Such an error would confirm the tenant and turn the query interface into an oracle
for enumerating tenants. The assertion is therefore "**no B-owned canary is returned**", not "zero
rows" — the caller's own partition may legitimately contain a line whose label or text happens to
match the string they supplied, and demanding zero rows would make a correct implementation fail the test. An error that
is identical whatever value was named confirms nothing and is not a failure: the backend rejects a
selector made only of its partition label this way, even for the caller's own partition. The
canary needs real storage, so this assertion is made by the recorded check in
[9.3](#93-the-end-to-end-check).

**Rule V2.** The gateway's adversarial tests **MUST** be hermetic and **MUST NOT** be solely unit
tests over the header-building function. They send real requests through the real gateway
configuration and the real decision endpoint, with everything they need started inside the test
run and the storage backend replaced by a stand-in that records what it receives. The assertion is
what crossed the boundary, or that nothing did. The interesting failures in this design are the
ones where the configuration, not the function, lets a request past: an uncovered route or a
protocol upgrade. What only a deployment can show, such as a permissive network policy or a direct
path to the backend, belongs to [9.3](#93-the-end-to-end-check) and to the component that owns it.

**Rule V3.** The gateway's isolation tests **MUST** run on every change and **MUST NOT** depend on a
deployed environment or on any service outside the test run. Each environment's own configuration
is covered by the recorded check in [9.3](#93-the-end-to-end-check), which is a verification step
rather than a test in this suite. The gateway is built to meet every rule within its control and
relies on the other components for theirs ([8.4](#84-what-this-repository-depends-on)). If one of
them turns out not to meet its side, that is fixed in the component that owns it.

## 8. Where the work lands

This contract spans five components, and they do not all live in one repository. That is the
main reason it exists as a written document rather than as review comments on a pull request:
no component can verify the boundary end to end from inside itself, so each one needs to know
precisely what the others guarantee.

The table below names each component and the repository its artifacts land in. It does not
assign people — who picks up a given component is a scheduling decision recorded on the
tracking work, not a property of the boundary.

### 8.1 What each component is responsible for

The split matters in one particular way: the rules about the token are **issuer** obligations
for this service and **verifier** obligations for the gateway, and they are not the same work.
Issuing a correctly shaped token does not enforce anything; enforcing on a token this service
did not shape is not possible. Both halves are required, and each is listed against the
component that performs it.

| Component | Artifacts land in | Responsibility | Rules it implements |
|---|---|---|---|
| **This service** | this repository | Minting the access token with the tenant claim, the log-read scope, and the log gateway resource audience, with exactly one audience per token; rejecting log-audience tokens on the API; establishing identifier provenance and binding each agent log identifier to exactly one tenant, system-owned and released on deletion; refreshing it on rotation; exposing the resolution the gateway consumes | T1 (issuance), T3–T4 (issuance), T6 (definition), T8, T12, M1, M2, M4, M5, M8, M10, M18–M20, L8–L9 (derivation definition) |
| **Identity-aware gateway** | this repository | Token validation and authorization on every request, mapping consumption, partition scope composition and header construction, read-surface coverage, fail-closed and uniform failure behaviour | T1, T2, T3–T4 (enforcement), T5, T6 (enforcement), T7, T9–T11, M9, M11, M12, M14–M17, G1–G10, L8–L9 (read-side application), S1, S4 |
| **Log storage and collection** | platform gitops | Storage-layer multi-tenancy including the multi-partition read scope the gateway depends on, collector partition routing and routing-field trust, query and fairness limits, TLS on every token-bearing hop, network isolation of the backend in every environment, write-path partition assignment for existing direct-push consumers | L1–L4, L6, L7, L8–L9 (ingestion application), L10–L12, T13, backend half of G3, G9 |
| **Agent deployment** | the agent's own chart, gitops | Structured log output carrying the agent's log identifier as a discrete field, populated by the agent runtime rather than from request data | L5, agent half of L6 |
| **Tenant Grafana** | platform gitops | The dedicated tenant-facing instance, registered against this service as its identity provider; a single shared datasource forwarding the caller's token; generic dashboards | S2, S3 |

### 8.2 Sequencing

The dependencies between these are real, and taking them out of order produces either a broken
deployment or a boundary that looks present and is not.

1. **The agent emits structured logs first.** The identifier is already present in the agent's
   logging context and already appears on its log lines, so this is a change of output **format**
   rather than new instrumentation. Until it lands there is no discrete field to route on, and
   routing must not be attempted against unstructured text
   ([L5](#52-partitioning-happens-at-ingestion)). Until then the agent's lines stay in the
   platform partition and tenants see only this service's lines — a usable intermediate state,
   not a blocked one.
2. **Query limits, fairness controls and network isolation land before any tenant gets access**
   ([L10](#55-preconditions-for-exposing-query-access), [L11](#55-preconditions-for-exposing-query-access),
   [L12](#55-preconditions-for-exposing-query-access)). These are preconditions for exposure, not
   follow-ups: after exposure, adding them is a regression risk rather than a safe default.
3. **The storage multi-tenancy cutover is coordinated, not a flag flip, and carries its own
   written plan.** Enabling native tenancy makes the partition header mandatory on **ingestion**
   as well as query. Any existing producer that pushes directly, outside the collector, starts
   failing at that moment unless the write path assigns its partition first. The cutover plan
   **MUST** enumerate every current producer, state what each one has to change — including
   "nothing" where that is the answer — and carry a runbook covering the rollback and any
   downtime. Assignment must be in place before or atomically with the cutover, verified in a
   lower environment, and every affected producer told ahead of the production change even
   where their client needs no change.
4. **The gateway and the tenant Grafana land last**, once the token surface and the storage
   boundary both exist. Standing up the access layer earlier would mean either exercising it
   against an unenforced backend — validating nothing — or creating a path that is open while
   its enforcement is still in flight.

### 8.3 What this repository guarantees to the others

So the other components can be built against a fixed surface:

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
  implementing owners in [8.1](#81-what-each-component-is-responsible-for);
- a security review of exposing tenant-facing observability data, taken against this document;
- each owner having the rules they implement reflected in their own tracked work.

It does **not** wait on any implementation. Blocking the contract on the work it specifies
would invert the dependency — the implementing work is written against this document.

### 9.2 Accepting each component

Acceptance criteria per component. Each is verifiable by someone other than whoever built it,
which is the point.

A component is accepted when the tests assigned to it in
[7.2](#72-required-tests) all pass — noting that a pass is sometimes a denial and sometimes a
correctly scoped success, and that a test naming two components is verified jointly rather than
twice.

| Component | Accepted when |
|---|---|
| **This service** | **P9, P11, N2, N23–N25, N39** pass, plus **P7, N3, N26, N27** jointly with the gateway: a token requested for the log gateway audience carries that audience alone and is rejected by the API; the log-read scope is grantable and expands consistently; an agent log identifier is captured only from a trusted agent, never accepted from a caller, bound to exactly one tenant under a write-time constraint, re-bindable by its own tenant, released on deletion, and never usable if it fails validation or encoding |
| **Identity-aware gateway** | **P1–P3, P5, P6, N1, N4–N20, N30–N35, N41** pass, plus **P7, N3, N26, N27** jointly with this service, run hermetically on every change against the real gateway configuration and decision endpoint ([V2](#72-required-tests), [V3](#72-required-tests)); the read surface is an enumerated allowlist; failures are externally indistinguishable. **P4** jointly with Grafana and the **N14** canary pass under [9.3](#93-the-end-to-end-check), neither of which a stand-in can prove |
| **Log storage** | **P8, N21, N22, N28, N29, N36–N38, N40** pass, plus **P10** jointly with agent deployment: native tenancy enabled with multi-partition reads, query and fairness limits in place; the backend unreachable from a tenant-reachable network position in **every** environment; unattributed or conflicting lines land in the platform partition, never a tenant one; no write path can place a line in a tenant partition it does not own; existing direct-push producers keep succeeding through the cutover; platform cross-tenant visibility retained |
| **Agent deployment** | **P10** passes jointly with platform observability: log output is structured, carries the log identifier as a discrete field populated by the runtime and not from request data, the field name is confirmed against real output rather than assumed, and a line emitted for a tenant is demonstrably readable **by that tenant** — no routing depends on pattern matching unstructured text |
| **Tenant Grafana** | **P4** passes jointly with the gateway: one instance, one org, one shared datasource, no tenant identity in any datasource field or URL; dashboards generic with no tenant variable; two tenants on the same dashboard each see only their own data |

### 9.3 The end-to-end check

Component-level acceptance is necessary and not sufficient — each owner can pass their own
criteria while the seam between two of them leaks. Before tenants are granted access in an
environment, one cross-team verification **MUST** be performed there and recorded:

Two real service tenants, each with a configured connector, each generating both service and
agent activity. For each tenant, using a real token through the real chain: they see both of
their own log sources, and neither sees any line belonging to the other — through a dashboard,
through ad-hoc query, and through label enumeration. Live tail returns the generic denial
([Rule G10](#64-live-tail-is-not-compatible-with-a-multi-partition-scope)). Then the adversarial
set against the deployed chain:
spoofed partition header, wrong audience, missing scope, a LogQL query naming the other tenant
with a canary line in place, and an attempt to bind the other tenant's agent identifier.

This is the only check that exercises the mapping, the token, the gateway, and the storage
partition together, and it is the one that would catch the failures a single component's own tests are
structurally unable to see.

---

## 10. Amending this contract

Changing a **MUST** or **MUST NOT** here changes a security boundary that several teams have
built against and reviewed as a whole. Such a change requires the same agreement as the
original: the owners in [8.1](#81-what-each-component-is-responsible-for), and a security review where the boundary
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
| M3 | *(Reserved — folded into [M2](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful) and [M5](#42-provenance-at-query-time))* | [4.1](#41-provenance--the-identifier-must-be-trustworthy-before-it-is-useful) |
| M4 | Resolved from the requesting tenant's own connector records | [4.2](#42-provenance-at-query-time) |
| M5 | No cross-tenant scan, join, or reverse lookup | [4.2](#42-provenance-at-query-time) |
| M6 | *(Reserved — explanatory prose under [4.2](#42-provenance-at-query-time))* | [4.2](#42-provenance-at-query-time) |
| M7 | *(Reserved — explanatory prose under [4.2](#42-provenance-at-query-time))* | [4.2](#42-provenance-at-query-time) |
| M8 | Resolution expressed per connector type | [4.3](#43-agent-agnostic-by-construction) |
| M9 | Identifier treated as opaque, but still validated | [4.3](#43-agent-agnostic-by-construction) |
| M10 | Refreshed on credential rotation | [4.4](#44-freshness) |
| M11 | Bounded cache, maximum staleness | [4.4](#44-freshness) |
| M12 | Cache keyed by service tenant, never by identifier | [4.4](#44-freshness) |
| M13 | *(Reserved — folded into [M11](#44-freshness))* | [4.4](#44-freshness) |
| M14 | Resolution fails closed | [4.5](#45-failure-behaviour) |
| M15 | Failures externally indistinguishable from one another | [4.5](#45-failure-behaviour) |
| M16 | Scope is all of the tenant's resolved identifiers, no tie-break | [4.6](#46-multiple-connectors-are-not-ambiguous) |
| M17 | Partition count bounded at ten; denied rather than truncated | [4.6](#46-multiple-connectors-are-not-ambiguous) |
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
| L11 | Per-partition concurrency, queue and timeout controls; 1/3 aggregate capacity cap; p95 ≤ 10 s and ≤ 2× baseline fairness target | [5.5](#55-preconditions-for-exposing-query-access) |
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
| G10 | Live tail excluded from the allowlist | [6.4](#64-live-tail-is-not-compatible-with-a-multi-partition-scope) |
| G11 | *(Reserved — retired)* | [6.4](#64-live-tail-is-not-compatible-with-a-multi-partition-scope) |

### S — tenant selection is never an input ([section 7](#7-tenant-selection-is-never-an-input))

| Rule | Subject | Where |
|---|---|---|
| S1 | Scope derived solely from the token and the resolution | [7](#7-tenant-selection-is-never-an-input) |
| S2 | A single shared Grafana datasource | [7](#7-tenant-selection-is-never-an-input) |
| S3 | Generic dashboards, no tenant selector | [7](#7-tenant-selection-is-never-an-input) |
| S4 | Tenant-selecting input on a real route neutralised silently | [7](#7-tenant-selection-is-never-an-input) |
| S5 | *(Reserved — covered by [G7](#63-complete-coverage-of-the-read-surface) and [G8](#63-complete-coverage-of-the-read-surface))* | [7](#7-tenant-selection-is-never-an-input) |
| S6 | *(Reserved — retired)* | [7](#7-tenant-selection-is-never-an-input) |

### V — how the tests must be written ([7.2](#72-required-tests))

| Rule | Subject | Where |
|---|---|---|
| V1 | No B-owned canary returned, not zero rows; asserted under [9.3](#93-the-end-to-end-check) | [7.2](#72-required-tests) |
| V2 | Gateway's adversarial tests are hermetic, against the real gateway configuration and a recording stand-in | [7.2](#72-required-tests) |
| V3 | Gateway's isolation tests run on every change with no deployed dependency; each environment gets the [9.3](#93-the-end-to-end-check) check | [7.2](#72-required-tests) |

