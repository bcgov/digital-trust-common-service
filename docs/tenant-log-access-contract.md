# Tenant Log Access and Isolation Contract

Status: Normative. This document defines the contract; it does not implement it.

This is the specification for how a service tenant reads its own logs through the tenant-facing
Grafana instance. Every component in the chain — the gateway, the tenant Grafana instance, Loki,
Alloy, the agent log configuration, and the write-path nginx — implements against this document.
Where this document and [tenant-observability-design.md](./tenant-observability-design.md)
disagree, this document wins.

The key words **MUST**, **MUST NOT**, SHOULD, SHOULD NOT, and MAY are used as defined in RFC 2119. Rule numbers (`T1`–`T13`, `M1`–`M20`, `L1`–`L12`, `G1`–`G10`, `S1`–`S4`,
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
**MUST** validate and encode the identifier as a partition key under [L8](#l8) before placing it in
`X-Scope-OrgID`.
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
| Identifier fails validation | Unusable as a partition key ([L8](#l8)) | Deny the entire request (`403`). |
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
Why: Bounds per-query fan-out in Loki and enables the per-partition concurrency cap in [L11](#l11).

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

<a id="l1"></a>
**L1: Loki native multi-tenancy is the boundary**
Owner: Log storage. Checked by: [P1](#72-required-tests), [P8](#72-required-tests), [N14](#72-required-tests).
Log isolation **MUST** be enforced by Loki's native multi-tenancy (`auth_enabled: true`), which
partitions data by the `X-Scope-OrgID` header.
Why: Enforces isolation below the query engine so arbitrary LogQL cannot cross a partition.

| Approach | Status | Reason |
|---|---|---|
| Loki native multi-tenancy (`X-Scope-OrgID`) | Required | Enforced below the query layer; a caller cannot cross a partition regardless of query syntax. |
| Label filtering on a shared partition | Rejected | Open-source Loki does not enforce mandatory labels; any caller can omit the label filter. |
| Proxy that parses and rewrites LogQL | Rejected | Puts a LogQL parser on the security boundary where any parser gap becomes a cross-tenant leak. |

<a id="l2"></a>
**L2: Isolation never depends on query shape**
Owner: Log storage, Gateway. Checked by: [N14](#72-required-tests), [N15](#72-required-tests).
No component **MUST** rely on the shape or content of a LogQL query for tenant isolation.
Why: Allows service tenants to use Explore, arbitrary LogQL, and the datasource API safely.

### 5.2 Partitioning happens at ingestion

<a id="l3"></a>
**L3: Partition assigned at ingestion from the log line**
Owner: Log storage (Alloy). Checked by: [P10](#72-required-tests).
Each log line **MUST** be assigned its Loki partition at ingestion by Alloy from an identifier
already present on the structured log line.
Why: Fixes partition ownership before any query runs so the read path cannot alter which partition
a line belongs to.

<a id="l4"></a>
**L4: Unattributed lines routed to the platform partition**
Owner: Log storage (Alloy). Checked by: [N29](#72-required-tests).
A log line with no extractable routing identifier **MUST** be routed to the platform partition
(`dt-services`) and **MUST NOT** be routed to a service tenant partition or a shared tenant-readable
partition.
Why: Keeps unattributed operational logs visible only to platform operators.

<a id="l5"></a>
**L5: Structured agent logs required before tenant routing**
Owner: Agent deployment, Log storage (Alloy). Checked by: [P10](#72-required-tests).
The credential agent **MUST** emit structured JSON logs carrying its agent log identifier as a
discrete field before Alloy routes agent lines to tenant partitions; Alloy **MUST NOT** extract
routing identifiers by regex matching unstructured text.
Why: Unstructured text matching can mis-route lines or match user-controlled text when log formats
change.

### 5.3 The routing field must be trusted, not merely structured

<a id="l6"></a>
**L6: Routing field populated only by trusted logging infrastructure**
Owner: This service, Agent deployment, Log storage (Alloy). Checked by: [P10](#72-required-tests), [N28](#72-required-tests).
The routing field (`tenant_id` on this service's lines, `wallet_id` on Traction/ACA-Py lines)
**MUST** be populated by the service's logging middleware or the agent runtime and **MUST NOT** be
populated from request payloads, user content, or caller-controlled log arguments. Alloy **MUST**
read only that top-level trusted field.
Why: Stops a caller from injecting another tenant's routing value into a log line emitted during
their request.

<a id="l7"></a>
**L7: Conflicting, duplicate, or malformed routing values go to the platform partition**
Owner: Log storage (Alloy). Checked by: [N28](#72-required-tests).
When a log line carries conflicting, duplicated, or malformed routing values, Alloy **MUST** route
the line to the platform partition (`dt-services`) with explicit duplicate-key handling rather than
relying on parser defaults.
Why: Prevents duplicate JSON keys from smuggling a foreign partition identifier past ingestion.

### 5.4 Partition keys must be derived, not passed through

<a id="l8"></a>
**L8: Derived, domain-separated, character-constrained partition keys**
Owner: This service, Gateway, Log storage. Checked by: [N26](#72-required-tests), [N27](#72-required-tests), [N40](#72-required-tests).
Every Loki partition key **MUST** be derived using the domain-separated prefixes below, constrained
to lowercase ASCII alphanumeric characters and hyphens within Loki's 150-byte limit, and **MUST
NOT** contain `|`, path characters, control characters, or raw unvalidated identifiers. The write
path **MUST NOT** assign any direct-push producer an identity starting with `t-` or `a-`.
Why: Prevents `|` from widening the `X-Scope-OrgID` partition set and prevents direct-push producer
identities from colliding with tenant or agent partitions.

<a id="l9"></a>
**L9: Identical partition key derivation at ingestion and query**
Owner: This service, Gateway, Log storage (Alloy). Checked by: [P1](#72-required-tests), [P10](#72-required-tests), [N26](#72-required-tests).
Alloy and the decision endpoint **MUST** apply the exact same partition key derivation rules and
**MUST** be tested against shared test vectors (including uppercase UUIDs, surrounding whitespace,
and `|`).
Why: Any mismatch between Alloy and the decision endpoint either drops logs silently or rejects
valid queries.

Service tenant partition key:

```text
partition_key = "t-" + tenant_id          e.g.  t-3f2a9c1e-7b4d-4e08-9a15-c2d4e6f80b13
valid         = ^t-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

Agent partition key:

```text
partition_key = "a-" + connector_type + "-" + agent_log_id
                e.g.  a-traction-8a11d0e4-12bc-4a91-b501-99e01d2c3f44
valid         = ^a-(traction|credo)-[a-z0-9-]{1,100}$
```

Both patterns are strict lowercase with no trimming or case-folding; for `traction`, `agent_log_id`
must also match a canonical lowercase UUID.

### 5.5 Preconditions for exposing query access

<a id="l10"></a>
**L10: Global query limits configured before tenant exposure**
Owner: Log storage (Loki). Checked by: [N36](#72-required-tests).
Global per-partition query limits (query time range, maximum series, maximum entries, and
cardinality) **MUST** be configured in Loki before any service tenant is granted query access.
Why: Prevents a single unbounded LogQL query from exhausting shared Loki queriers.

<a id="l11"></a>
**L11: Fairness target and one-third aggregate capacity cap**
Owner: Log storage (Loki), Gateway (where admission/rate control is required). Checked by: [N37](#72-required-tests).
Per-partition concurrency (`max_query_parallelism`), outstanding-request queue
(`max_outstanding_requests_per_tenant`), and timeout controls **MUST** be configured in Loki before
tenant exposure, and per-tenant admission or rate control **MUST** additionally be enforced at the
gateway wherever Loki's per-partition bounds alone do not hold the cap or the fairness target below:

- a service tenant **MUST NOT** hold more than one third of total query capacity (querier replicas
  multiplied by per-querier concurrency) across all partitions in its partition set ([M17](#m17))
  and all requests it has in flight at once; per-partition concurrency and queue bounds **MUST** be
  derived from the cap, the 10-partition bound, and permitted in-flight requests together (with the
  gateway enforcing per-tenant admission where per-partition bounds cannot hold the aggregate cap on
  their own), and recalculated whenever querier capacity changes; and
- while a competing service tenant continuously saturates its allowance across its partition set, a
  tenant's reference query at the upper bound of L10 across its partition set (measured at both 2
  and 10 partitions over at least 20 runs across 10 minutes with the results cache bypassed) **MUST**
  complete within 10 seconds at p95 and within 2× its uncontended baseline, with no error rate
  increase and with the flooding tenant's peak concurrent sub-queries staying within the one-third
  capacity cap, run and recorded before tenant exposure and whenever querier capacity changes.

Why: Ensures a noisy service tenant with up to ten partitions cannot starve other tenants sharing
Loki.

<a id="l12"></a>
**L12: Loki reachable on the read path only through the gateway**
Owner: Log storage. Checked by: [N21](#72-required-tests).
Loki's read path **MUST NOT** be reachable from anywhere in the cluster except through the gateway
in every environment, including development and test.
Why: Loki trusts `X-Scope-OrgID` unconditionally, so direct network access to Loki would bypass
all tenant isolation.

## 6. The gateway header contract

The gateway and decision endpoint turn a validated token into a Loki partition set header.

### 6.1 The header is computed, never conveyed

<a id="g1"></a>
**G1: `X-Scope-OrgID` computed from token and resolved connectors**
Owner: Gateway. Checked by: [P1](#72-required-tests), [P2](#72-required-tests), [P5](#72-required-tests).
The gateway **MUST** set `X-Scope-OrgID` solely from the validated token's `tenant_id` ([T3](#t3))
and the identifiers resolved under [section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier),
each encoded under [L8](#l8). No other input **MUST** contribute.
Why: Guarantees that the partition set reflects only verified tenant ownership.

<a id="g2"></a>
**G2: Inbound `X-Scope-OrgID` unconditionally overwritten**
Owner: Gateway. Checked by: [N10](#72-required-tests), [N11](#72-required-tests), [N12](#72-required-tests).
The gateway **MUST** overwrite any inbound `X-Scope-OrgID` header and **MUST NOT** append to,
merge with, or forward any caller-supplied value, including on rejected requests.
Why: Prevents a caller from injecting or appending another service tenant's partition key.

<a id="g3"></a>
**G3: Partition set contains only the tenant's own partitions**
Owner: Gateway, Log storage (Loki). Checked by: [P1](#72-required-tests), [P2](#72-required-tests), [P5](#72-required-tests).
The `X-Scope-OrgID` partition set **MUST** contain only `t-<tenant_id>` plus the `a-<type>-<id>`
partitions of that service tenant's active connectors ([M16](#m16)). It **MUST NOT** include the
platform partition (`dt-services`), a default partition, a wildcard, or another tenant's partition,
and Loki **MUST** have multi-partition reads enabled.
Why: Restricts every Loki read to the exact partitions owned by the caller's service tenant.

<a id="g4"></a>
**G4: Caller `Authorization` header stripped before Loki**
Owner: Gateway. Checked by: [N13](#72-required-tests).
The gateway **MUST** strip the caller's `Authorization` header before forwarding the request to
Loki, replacing it only with the gateway's own Loki basic-auth credentials if required.
Why: Prevents tenant bearer tokens from reaching Loki or appearing in upstream logs.

### 6.2 The gateway does not read the query

<a id="g5"></a>
**G5: No LogQL parsing, rewriting, or injection at the gateway**
Owner: Gateway. Checked by: [N14](#72-required-tests), [N15](#72-required-tests).
The gateway **MUST NOT** parse, rewrite, validate, or inject label matchers into the LogQL query.
Why: Partition isolation in Loki (`X-Scope-OrgID`) already constrains results regardless of query
content, without risking parser bugs.

### 6.3 Complete coverage of the read surface

<a id="g6"></a>
**G6: Every exposed read route enforces the contract**
Owner: Gateway. Checked by: [P6](#72-required-tests), [N19](#72-required-tests).
The gateway **MUST** apply token validation and `X-Scope-OrgID` scoping to every route it exposes,
including label, series, label-values, index, and stats endpoints.
Why: Metadata and label endpoints derive from log content and would leak cross-tenant data if left
unscoped.

<a id="g7"></a>
**G7: Allowlist of Loki read routes**
Owner: Gateway. Checked by: [N17](#72-required-tests), [N18](#72-required-tests), [N19](#72-required-tests).
Gateway route handling **MUST** be an explicit allowlist of Loki read routes; any path or HTTP
method not on the allowlist **MUST** be denied.
Why: Ensures administrative, write, or newly added Loki endpoints are unreachable by default.

<a id="g8"></a>
**G8: Generic, identical denial for unenumerated routes**
Owner: Gateway. Checked by: [N17](#72-required-tests), [N20](#72-required-tests).
Denial of any unknown or unenumerated route **MUST** return the same generic status (`403`) and body
regardless of why the path was rejected.
Why: Prevents callers from probing which routes exist behind the gateway.

<a id="g9"></a>
**G9: No tenant read path bypasses the gateway**
Owner: Log storage. Checked by: [N21](#72-required-tests), [N38](#72-required-tests).
No read path to Loki that bypasses the gateway **MUST** be reachable by a tenant user in any
environment, and the Alloy/nginx write path **MUST NOT** be usable to read logs.
Why: Prevents callers from reading logs through an ingestion endpoint or an unprotected internal
service.

### 6.4 Live tail is not compatible with a multi-partition set

<a id="g10"></a>
**G10: Live tail excluded from the allowlist**
Owner: Gateway. Checked by: [N20](#72-required-tests).
Live tail (`/loki/api/v1/tail`) **MUST** be excluded from the allowlist and **MUST** receive the
same generic denial as any other unenumerated route (G8) for every service tenant regardless of
partition count; exposing live tail requires an amendment under [section 10](#10-amending-this-contract).
Why: Loki refuses `/loki/api/v1/tail` when `X-Scope-OrgID` contains multiple partitions, and
allowing tail only for single-partition tenants would leak a tenant's connector count.

## 7. Tenant selection is never an input

<a id="s1"></a>
**S1: Partition set derived only from token and connector resolution**
Owner: Gateway. Checked by: [N10](#72-required-tests), [N14](#72-required-tests), [N16](#72-required-tests).
The `X-Scope-OrgID` partition set **MUST** be derived solely from the validated token and the
connector resolution in [section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier), and
**MUST NOT** be influenced by any caller-controlled input:

- query or URL parameters (`?tenant=`, `?org_id=`, `?scope=`);
- path segments or per-tenant URLs;
- inbound request headers including `X-Scope-OrgID` ([G2](#g2));
- Grafana datasource configuration headers, URLs, or secure fields;
- dashboard template variables;
- request body fields, cookies, or session state;
- LogQL selectors ([G5](#g5)); or
- upstream identity provider groups, roles, or claims ([2.3](#23-upstream-identity-is-not-tenant-identity)).

Why: Any caller-selectable tenant input turns a crafted parameter, header, or URL into a
cross-tenant read.

<a id="s2"></a>
**S2: Single shared Grafana datasource**
Owner: Tenant Grafana. Checked by: [P4](#72-required-tests).
Tenant Grafana **MUST** use a single shared Loki datasource for all tenant users, with no tenant
identity in its URL, headers, or configuration.
Why: Per-tenant datasources duplicate access control in static configuration that can drift or be
misprovisioned.

<a id="s3"></a>
**S3: Generic dashboards with no tenant selector**
Owner: Tenant Grafana. Checked by: [P4](#72-required-tests).
Tenant-facing dashboards **MUST** be generic and identical for all service tenants, and **MUST NOT**
embed a tenant identifier or a tenant-selector template variable.
Why: Each service tenant sees its own data because the gateway scopes the token, not because the
dashboard filters by tenant.

<a id="s4"></a>
**S4: Silent neutralisation of tenant-selecting inputs on allowlisted routes**
Owner: Gateway. Checked by: [N16](#72-required-tests).
On an allowlisted route, any tenant-selecting query parameter, body field, or header **MUST** be
ignored so the request is served for the caller's own service tenant rather than rejected with a
parameter-specific error.
Why: Ignoring extraneous parameters gives an attacker no signal about parameter handling, while
unknown paths are denied generically under [G7](#g7) and [G8](#g8).

### 7.1 Threat model

The adversary is a legitimate user holding a valid token for service tenant A, with full control of
their HTTP client and able to configure their own connector, attempting to read or write service
tenant B's logs.

On the query path, the caller controls the LogQL query completely and controls the `X-Scope-OrgID`
partition set not at all. On the write and connector-binding paths, a caller can influence data
rather than the query. The query path is therefore safe by construction, while the write and
binding paths are safe by enforcing the provenance and derivation rules in [section 4](#4-mapping-a-service-tenant-to-its-agent-log-identifier)
and [section 5](#5-storage-layer-tenancy). Every attack and its controlling rule are tested in
7.2.

### 7.2 Required tests

These tests define what "the contract holds" means. They **MUST** exist as automated, gating tests
owned by the component that implements the rule, except for the cases [9.2](#92-accepting-each-component)
assigns to [9.3](#93-the-end-to-end-check) or to [L11](#l11)'s benchmark, and a component **MUST
NOT** be accepted without them.

Positive — the intended path works:

| # | Given | Expect | Component |
|---|---|---|---|
| P1 | Valid token, `logs:read` OAuth scope, tenant A, one active connector | Query succeeds; partition set is `t-<A>\|a-<type>-<id>` ([T3](#t3), [T5](#t5), [M4](#m4), [G1](#g1), [G3](#g3)) | Gateway |
| P2 | Tenant A has no connector | Query succeeds; partition set is `t-<A>` only ([T3](#t3), [M14](#m14), [G1](#g1), [G3](#g3)) | Gateway |
| P3 | Token carrying only `tenants:admin` OAuth scope | Allowed via scope expansion ([T6](#t6)) | Gateway |
| P4 | Tenants A and B each open the same shared dashboard | Each sees only their own log lines ([S2](#s2), [S3](#s3)) | Grafana + gateway |
| P5 | Tenant A has multiple active connectors | Partition set includes all of A's resolved partitions and none of B's ([M4](#m4), [M8](#m8), [M16](#m16), [G3](#g3)) | Gateway |
| P6 | Label, series, and label-values endpoints with a valid token | Succeed, constrained to A's partition set ([G6](#g6)) | Gateway |
| P7 | Connector rotated to a new identifier, no invalidation signal delivered | New identifier takes effect within five minutes ([M10](#m10), [M11](#m11)) | This service + gateway |
| P8 | Platform operator via the platform Grafana path | Full cross-tenant visibility retained ([L1](#l1)) | Log storage |
| P9 | An identifier is bound to tenant A for the first time | Binding succeeds and is usable ([M2](#m2)) | This service |
| P10 | An agent log line emitted for tenant A carrying A's `wallet_id` | Routed by Alloy to A's partition and returned to A's token only ([L3](#l3), [L5](#l5), [L6](#l6), [L9](#l9)) | Agent deployment + Log storage |
| P11 | Tenant A deletes and re-creates a connector for the same sub-wallet, then rotates credentials | Binding succeeds both times and A's agent logs stay visible ([M2](#m2), [M10](#m10), [M19](#m19), [M20](#m20)) | This service |

Adversarial — each must produce the stated safe outcome:

| # | Given | Expect | Component |
|---|---|---|---|
| N1 | Token with the API audience | `401`; nothing forwarded ([T9](#t9)) | Gateway |
| N2 | Log-audience token presented to the API | `401` ([T8](#t8), [T9](#t9)) | This service |
| N3 | Signed token whose `aud` contains both audiences | `401` from both validators; issuance never produces one ([T12](#t12)) | This service + gateway |
| N4 | Valid token without `logs:read` OAuth scope | `403`; nothing forwarded ([T5](#t5)) | Gateway |
| N5 | Expired, unsigned, wrong-issuer, or wrong-key token | `401` ([T1](#t1)) | Gateway |
| N6 | No token, or a cookie / basic-auth / upstream / agent token ([T2](#t2)) | `401` | Gateway |
| N7 | Token with absent, empty, or repeated `tenant_id` | `401` ([T3](#t3), [T4](#t4)) | Gateway |
| N8 | Token carrying platform-admin role | Scoped to its own `tenant_id`; no widening ([T11](#t11)) | Gateway |
| N9 | Sequential requests with tenant A's then tenant B's token on one connection | Each scoped to its own tenant; no decision reuse ([T7](#t7)) | Gateway |
| N10 | Inbound `X-Scope-OrgID: B` | Scoped to A; `B` never reaches Loki ([G2](#g2), [S1](#s1)) | Gateway |
| N11 | Inbound `X-Scope-OrgID: A\|B` | Scoped to A only; no merge ([G2](#g2)) | Gateway |
| N12 | Inbound `X-Scope-OrgID` on a rejected request | Rejected; nothing forwarded to Loki ([G2](#g2)) | Gateway |
| N13 | Forwarded request inspected at Loki | Caller's `Authorization` header is absent; only gateway Loki login may be present ([G4](#g4)) | Gateway |
| N14 | LogQL explicitly selecting tenant B's labels | Forwarded unchanged, scoped to A only ([G5](#g5), [S1](#s1)); against real Loki with a B-owned canary line, the canary is not returned (V1) | Gateway |
| N15 | Query via Explore, datasource API, or curl bypassing dashboards | Scoped to A identically ([L2](#l2), [G5](#g5)) | Gateway |
| N16 | Tenant-selecting parameter or body field on an allowlisted route | Ignored; scoped to A ([S1](#s1), [S4](#s4)) | Gateway |
| N17 | Tenant-selecting path or any unenumerated route | Generic `403` denial, identical for every unknown path ([G7](#g7), [G8](#g8)) | Gateway |
| N18 | A Loki read route that exists but is not on the allowlist | Generic `403` denial ([G7](#g7)) | Gateway |
| N19 | Label-values request naming another tenant's partition | Scoped to A's partition set ([G6](#g6), [G7](#g7)) | Gateway |
| N20 | Live-tail request (`/loki/api/v1/tail`) | Generic `403` denial, identical regardless of partition count ([G8](#g8), [G10](#g10)) | Gateway |
| N21 | Direct request to Loki with a chosen `X-Scope-OrgID` header | Unreachable from anywhere in the cluster in every environment ([L12](#l12), [G9](#g9)) | Log storage |
| N22 | Plaintext request to any token-bearing hop | Refused or redirected; no token accepted over plaintext ([T13](#t13)) | Log storage |
| N23 | Tenant B attempts to bind an identifier already bound to tenant A | Binding refused; A's binding unchanged ([M2](#m2), [M5](#m5)) | This service |
| N24 | Two tenants attempt to bind the same identifier concurrently | Exactly one succeeds ([M2](#m2)) | This service |
| N25 | Connector pointed at an untrusted endpoint asserting an identifier | Identifier not usable for partitioning ([M1](#m1)) | This service |
| N26 | Identifier containing `\|`, a path or control character, or over length limit | Rejected; never reaches `X-Scope-OrgID` ([M9](#m9), [L8](#l8), [L9](#l9)) | This service + gateway |
| N27 | Two different source identifiers deriving to the same partition key | Collision prevented by domain-separated derivation ([L8](#l8)) | This service + gateway |
| N28 | Log line carrying a foreign routing value via request data, user content, or duplicate JSON key | Routed by Alloy to `dt-services`, never to the named tenant ([L6](#l6), [L7](#l7)) | Log storage |
| N29 | Agent log line with no extractable identifier | Routed by Alloy to `dt-services`, never a tenant partition ([L4](#l4)) | Log storage |
| N30 | Connector inactive, or present with no `agentLogId` | That partition omitted; `t-<A>` lines still served ([M14](#m14)) | Gateway |
| N31 | Partition resolution fails with a database or decryption error | Denied (`403`); not degraded to `t-<A>` only ([M14](#m14)) | Gateway |
| N32 | Responses compared across an unusable identifier and a database error | Identical `403` status and body; a tenant with no connector succeeds and is distinct ([M15](#m15)) | Gateway |
| N33 | Any failure response body inspected | No other tenant's identifier, connector count, or existence signal ([M15](#m15)) | Gateway |
| N34 | Identifier rotated; queries issued at the five-minute bound and just after | Old binding not honoured past five minutes ([M11](#m11), [M12](#m12)) | Gateway |
| N35 | Spoofed `Host` or forwarded headers matching the gateway audience | `401`; audience check unaffected ([T10](#t10)) | Gateway |
| N36 | Query exceeding global Loki limits | Rejected by Loki limits; other tenants unaffected ([L10](#l10)) | Log storage |
| N37 | Tenant A floods many individually compliant queries | Tenant A's peak concurrent sub-queries stay within the one-third capacity cap and Tenant B stays within the fairness target, measured by L11's benchmark ([L11](#l11)) | Log storage + gateway |
| N38 | Read attempted through the Alloy/nginx write path | Not readable ([G9](#g9)) | Log storage |
| N39 | Tenant supplies an `agentLogId` directly in a connector create or update request | Not persisted, not used for partitioning, attempt recorded ([M18](#m18)) | This service |
| N40 | Direct-push producer credential whose identity starts with `t-` or `a-` | Refused; no write into a tenant or agent partition ([L8](#l8)) | Log storage |
| N41 | Tenant's resolved partition count exceeds ten | Denied (`403`), never silently truncated ([M17](#m17)) | Gateway |

<a id="v1"></a>
**V1: N14 asserts no foreign canary line is returned**
Owner: Gateway, Log storage. Checked by: [N14](#72-required-tests).
A query naming another service tenant **MUST** return no log line belonging to that tenant and
**MUST NOT** return an error that depends on whether that tenant exists. In real Loki ([9.3](#93-the-end-to-end-check)),
N14 asserts that a canary line in tenant B's partition is not returned to tenant A, rather than
demanding zero rows when tenant A's own partition happens to match the selector.
Why: Demanding an error or zero rows would either create a tenant-existence oracle or fail when a
tenant's own logs contain the queried string.

<a id="v2"></a>
**V2: Hermetic gateway adversarial tests against real Envoy config**
Owner: Gateway. Checked by: [P1](#72-required-tests)–[P3](#72-required-tests), [P5](#72-required-tests), [P6](#72-required-tests), [N1](#72-required-tests), [N3](#72-required-tests)–[N20](#72-required-tests), [N26](#72-required-tests), [N27](#72-required-tests), [N30](#72-required-tests)–[N35](#72-required-tests), [N41](#72-required-tests).
The gateway's adversarial tests **MUST** be hermetic and **MUST NOT** be only unit tests over the
header-building function: they run real requests through the rendered Envoy configuration and real
decision endpoint against a recording Loki stand-in.
Why: Catches proxy configuration flaws such as unenumerated routes, path normalization tricks, or
header forwarding bugs that unit tests cannot see.

<a id="v3"></a>
**V3: Gateway isolation tests run on every change without a deployed environment**
Owner: Gateway. Checked by: CI `test` job (`npm run test:log-gateway`).
The gateway's hermetic isolation suite **MUST** run on every change in CI and **MUST NOT** depend
on a deployed environment or external network service; environment-specific wiring is verified
separately under [9.3](#93-the-end-to-end-check).
Why: Prevents regressions on pull requests before changes reach any shared cluster.

## 8. Where the work lands

This contract spans five components across multiple repositories so each component knows what the
others guarantee.

### 8.1 What each component is responsible for

Each rule's `Owner:` line is the authoritative list of implementing components. Token rules have
both an issuer side (this service) and a verifier side (the gateway and decision endpoint), and
onboarding a service tenant requires no configuration change in Alloy, Loki, or Tenant Grafana:

- This service (this repository):
  - Mints single-audience access tokens carrying `tenant_id`, the `logs:read` OAuth scope, and the
    log gateway audience, and rejects log-audience tokens on the API.
  - Captures each agent log identifier from a trusted agent, binds it to at most one service tenant,
    refreshes it on rotation, releases it on deletion, and resolves the partition set for the
    decision endpoint.
- Gateway and decision endpoint (this repository):
  - Validates the token and OAuth scope on every request, resolves the partition set, sets
    `X-Scope-OrgID`, enforces the Loki read-route allowlist, fails closed with uniform error
    responses, and enforces per-tenant admission or rate control where [L11](#l11) requires it.
- Log storage and collection (platform gitops — Loki, Alloy, and write-path nginx):
  - Enforces Loki multi-tenancy (`auth_enabled: true`) with multi-partition reads, Alloy routing and
    field trust, Loki query and fairness limits, TLS on token-bearing hops, network isolation of
    Loki in every environment, and write-path partition assignment for direct-push producers.
- Agent deployment (agent chart and gitops):
  - Emits structured JSON logs carrying the agent log identifier (`wallet_id` for the current agent)
    as a discrete field populated by the agent runtime.
- Tenant Grafana (platform gitops):
  - Runs the tenant-facing Grafana instance authenticated via this service's OIDC provider, with one
    shared Loki datasource forwarding the caller's bearer token and generic dashboards.

### 8.2 Sequencing

1. The credential agent emits structured JSON logs first ([L5](#l5)). Until it does, agent lines
   stay in `dt-services` and service tenants see only `t-<tenant_id>` lines.
2. Loki query limits, fairness controls, and network isolation land before any service tenant gets
   access ([L10](#l10), [L11](#l11), [L12](#l12)).
3. The Loki multi-tenancy cutover follows a written plan. Because enabling `auth_enabled: true`
   requires `X-Scope-OrgID` on ingestion as well as queries, the cutover plan **MUST** list every
   current direct-push producer, state what each must change (including "nothing"), put write-path
   partition assignment in place before or atomically with the cutover (verified in a lower
   environment), notify every affected producer ahead of the production change, and provide a
   rollback runbook before production cutover.
4. The gateway and Tenant Grafana are exposed last, once the token surface and Loki boundary are in
   place.

## 9. Acceptance and closure

### 9.1 Closing this contract

This contract is complete when agreed by the component owners:

- the glossary in [section 2](#2-what-tenant-means-in-each-service) is agreed by all teams;
- the rules in sections 3–7 are accepted by the owners in 8.1;
- security review of tenant log access is completed against this document; and
- each owner has tracked work for the rules it implements.

### 9.2 Accepting each component

A component is accepted when every test in [7.2](#72-required-tests) naming that component (and
every rule listing that component as `Owner`) passes:

- This service:
  - Log-audience tokens carry only the gateway audience and are rejected by the API.
  - `logs:read` is grantable and expands consistently under `tenants:admin`.
  - Agent log identifiers are captured only from a trusted agent, never accepted from a caller,
    bound to one service tenant at write time, re-bindable by that tenant, released on deletion, and
    rejected if malformed.
- Gateway:
  - Its hermetic isolation suite ([V2](#v2), [V3](#v3)) passes on every change against the rendered
    Envoy configuration, real decision endpoint, and recording Loki stand-in.
  - The Loki read surface is an explicit allowlist and all denials are generic.
  - Shared-dashboard isolation (P4) and the real-Loki canary check (N14, [V1](#v1)) pass under 9.3,
    and N37 passes jointly with log storage wherever [L11](#l11) requires gateway-side rate control.
- Log storage:
  - Loki native multi-tenancy is enabled with multi-partition reads, query limits ([L10](#l10)), and
    per-partition concurrency and queue caps ([L11](#l11)), verified by the fairness benchmark (N37).
  - Loki is unreachable from anywhere in the cluster except through the gateway in every environment.
  - Unattributed or conflicting log lines route to `dt-services`, direct-push producers cannot write
    into `t-` or `a-` partitions, existing direct-push producers keep succeeding through the
    cutover, and platform operators retain cross-tenant visibility.
- Agent deployment:
  - Agent logs are structured JSON carrying the agent log identifier (`wallet_id` for the current
    agent) from the agent runtime, and a line emitted for a service tenant is readable by that
    tenant through the gateway.
- Tenant Grafana:
  - One instance, one org, one shared datasource with no tenant identity in configuration, and
    generic dashboards where two service tenants each see only their own logs.

### 9.3 The end-to-end check

Before service tenants are granted access in an environment, one cross-team verification **MUST** be
run and recorded in that environment using two real service tenants, each with an active connector
generating service and agent logs:

1. Through a shared dashboard, Explore ad-hoc queries, and label enumeration, each service tenant
   sees both of its own log sources and none of the other tenant's.
2. Live tail (`/loki/api/v1/tail`) returns the generic `403` denial ([G10](#g10)).
3. The adversarial checks pass against the deployed chain: spoofed `X-Scope-OrgID`, API-audience
   token, missing `logs:read` OAuth scope, a LogQL query naming the other tenant with a canary line
   in real Loki ([V1](#v1)), and an API attempt to bind the other tenant's agent log identifier.

## 10. Amending this contract

Changing any **MUST** or **MUST NOT** in this document requires agreement from all component owners
in [8.1](#81-what-each-component-is-responsible-for) and a security review whenever the isolation
boundary changes.

Exposing metrics or traces to service tenants ([1.4](#14-logs-only--metrics-and-traces-are-excluded))
or issuing a token that authorizes more than one service tenant ([T4](#t4)) requires a new contract
rather than an amendment. Adding a new credential agent connector type is not an amendment and is
already covered by [M8](#m8) and [M9](#m9).

