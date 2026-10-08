# Threat Model — Cross-Reference with VCDM Threat Model v2.1

This document maps `digital-trust-common-service` against the
[Verifiable Credentials Data Model Threat Model v2.1](https://www.w3.org/TR/vc-data-model-threat-model-2.1/)
(W3C Group Note Draft). It identifies which of the 25 threats in that model
apply to our deployment, what already mitigates them, and where the gaps are.

It complements, and does not replace, [ARCHITECTURE.md](./ARCHITECTURE.md)'s
"Security Considerations" table — that table covers our own API surface;
this document covers the VC ecosystem-level threats the W3C note addresses,
and where responsibility for each one actually sits once our service and its
delegated agents are in the picture.

Status: **draft, not yet reviewed for CI or committed**. Content reflects a
point-in-time cross-reference and should be revisited whenever the VCDM
threat model, our adapter set (Traction/Credo), or our supported protocols
(DIDComm, OID4VCI/VP) change materially.

---

## 1. Why a straight role mapping doesn't work

The threat model's data-flow diagram assumes three single systems: an
**Issuer System (C1)**, a **Holder System (C2)**, and a **Verifier System
(C3)**. Our deployment does not have a 1:1 match to any of them — we are a
piece of *both* C1 and C3, chained in front of a delegated agent that does
the actual cryptography, and we never touch C2 at all. In the BC Gov
ecosystem, **C2 is [bcgov/bc-wallet-mobile](https://github.com/bcgov/bc-wallet-mobile)**
— an independently maintained, independently released mobile wallet app.
It is not part of this repository or this threat model's remediation scope;
it is referenced here only as the concrete system occupying the E2/C2 role
in the data flow.

### 1.1 Actors

| VCDM role | Who plays it here | How it authenticates |
|---|---|---|
| **E1 Issuer / E3 Verifier** (the legal/trust entity) | The **tenant** (a ministry, org, or other API consumer) | Its backend calls our API via OAuth `client_credentials` (our own `oidc-provider`), or a human tenant admin via the UI (Keycloak-federated OIDC + PKCE) |
| **"Issuer/Verifier System" (C1/C3)** | **Us, chained in front of Traction/Credo** — see §1.2 | N/A — we are part of the system, not a caller |
| **E2 Holder** | The end-user's wallet — [bcgov/bc-wallet-mobile](https://github.com/bcgov/bc-wallet-mobile) | Never authenticates to us. It only ever talks DIDComm/OID4VCI/OID4VP to the **agent** (Traction/ACA-Py or Credo); we have no direct channel to it |

**Consequence:** P1 "Establish Confidence" (identity proofing) happens
entirely inside the tenant's own system, before they ever call
`POST /credentials/offer`. We validate the *shape* of `attributes` (DTO
validation), never their truthfulness. Any threat premised on issuer-side
identity proofing (T2) is the tenant's responsibility, not ours, and nothing
in our docs should claim otherwise.

### 1.2 Trust boundaries — the chain has more hops than the diagram shows

The threat model draws one box for "Issuer System" and one for "Verifier
System." Ours is really **two chained systems, each with its own trust
boundary and its own credential**:

```
API Consumer  ──(1)──▶  digital-trust-common-service  ──(2)──▶  Traction / Credo  ──(5)──▶  bc-wallet-mobile
   (tenant)                  (us: orchestration,                (agent: DIDs, VC          (DIDComm /
                              tenant/API auth, audit,             signing keys,             OID4VCI-VP)
                              rate limiting)                      ledger, protocol
                                                                   execution)
                         ◀──(3) inbound webhook──────────────────
                         ──(4) outbound webhook (planned)──▶
```

| # | Boundary | Direction | Credential | Where documented |
|---|---|---|---|---|
| 1 | API Consumer ↔ Us | Consumer → Us | OAuth `client_credentials` JWT (our `oidc-provider`), scopes + `tenant_id` claim | ARCHITECTURE.md "Authentication & Authorization" |
| 2 | **Us ↔ Traction/Credo** | Us → Agent | Per-tenant `ConnectorCredential.api_key` (AES-256-GCM at rest), exchanged for a short-lived **sub-wallet bearer token** via `/multitenancy/token`, cached per-pod by `TractionTokenManager` | ARCHITECTURE.md:227, 655, 1502, 1601 |
| 3 | Agent → Us (inbound webhook) | Traction/Credo → Us | Shared `X-Api-Key` connector secret on `/connectors/{id}/webhooks/traction/topic/{topic}` | openapi.yaml "Webhook Ingestion" |
| 4 | Us → Consumer (outbound webhook) | Us → Consumer | HMAC-SHA256, tenant-specific secret — **planned, not yet implemented** (`WebhookDispatchWorker` currently only validates/acknowledges) | ARCHITECTURE.md:628, 1449 |
| 5 | [bc-wallet-mobile](https://github.com/bcgov/bc-wallet-mobile) ↔ Agent | either | DIDComm pairwise connection, or OID4VCI/OID4VP | Entirely inside the agent's boundary — invisible to us |

Boundary 2 has no equivalent anywhere in the VCDM threat model, and it is
arguably the single most concentrated risk in the deployment:
`ConnectorCredential.api_key` is a master key that lets us mint a bearer
token and act as *that tenant's entire Traction sub-wallet* — issue, revoke,
read connections, everything. Compromise of that row (T17) has a blast
radius independent of anything protecting boundary 1.

### 1.3 Responsibility split (who does what)

| Layer | Owns | Does **not** own |
|---|---|---|
| **Our abstraction layer** | AuthN/Z of the API Consumer; tenant isolation; connector-credential encryption at rest; operation tracking/idempotency; audit trail; rate limiting; inbound webhook authn (boundary 3) and outbound webhook signing (boundary 4, planned); profile → cred_def/connector resolution; enforcing verification profiles reference a real issuance profile (T9 mitigation) | Identity proofing; VC cryptography; DID/key management; ledger interaction |
| **Delegated to Traction/ACA-Py or Credo** | DID generation, pairwise connection establishment, VC signing (P2/P3), presentation cryptographic verification (P10), revocation-registry/status-list publish & check (P4/P5/P11), VC-layer signing-key custody | Anything about *our* tenants, scopes, or API surface |
| **Delegated to the API Consumer (tenant)** | P1 Establish Confidence; deciding what attributes to assert and their accuracy; P12 Validate — business policy on top of our "cryptographically valid + unrevoked" result; everything that happens to disclosed data after the API call returns (T24) | Nothing about our infrastructure — but everything about *meaning* |

We also do not independently re-verify presentations: we trust whatever the
agent's webhook (boundary 3) tells us, authenticated only by a shared
`X-Api-Key`, not a per-payload HMAC. If that key leaks, an attacker can
forge a "verified"/"issued" state transition without touching real
cryptography — see T1/T7 below.

### 1.4 Credential format vs. profile vs. exchange/protocol

Three axes that are easy to conflate:

| Axis | Answers | Examples | Owned by |
|---|---|---|---|
| **Credential format** | How is claim data structured *and secured*? | AnonCreds (CL-signatures, ZKP selective disclosure), W3C VC (Data Integrity / JOSE-COSE), SD-JWT-VC, mDL/mdoc (ISO 18013-5, COSE/CBOR) | The **agent** — Traction does AnonCreds only today; Credo adds the rest post-MVP |
| **Profile** (our concept) | Business-facing config: format + schema + connector + protocol hint under one name/version (`drivers-license/1.0`) | Issuance profile, Verification profile (references an issuance profile) | **Us** — the API Consumer never sees format/cred_def directly |
| **Exchange / protocol** | How the credential/presentation physically moves | DIDComm v1/v2 (Aries RFC 0453/0454, requires a `connection_id`), OID4VCI/OID4VP (connectionless, URI-based) | **Us** (routing via `connection_id` presence) + **agent** (execution) |

These are orthogonal in principle. Today, MVP = AnonCreds + DIDComm +
Traction only, so the axes happen to collapse to one path. Post-MVP (Credo),
profiles will genuinely mix format/protocol combinations, and that is
exactly where the identifier-reuse gaps in §2 (T10, T14) become material —
OID4VCI/VP's connectionless model has no pairwise-DID equivalent to fall
back on.

---

## 2. Threat cross-reference

For each threat: our exposure given the actor/boundary model in §1, what
mitigates it today, and the gap if any.

### Target Threats (T1–T2)

| # | Threat | Our exposure | Coverage | Gap |
|---|---|---|---|---|
| T1 | Credential Content Tampering | Securing mechanism (Data Integrity/JOSE-COSE/AnonCreds signature) is verified by the **agent**, not us. We relay whatever the agent's webhook reports. | Delegated correctly to the agent for the credential itself. | We do not detect a **forged webhook** claiming false verification — see boundary 3 in §1.2 and T7 below. |
| T2 | Identity Proofing Failure at Issuance | P1 happens entirely in the API Consumer's system. | DTO validation confirms attribute *shape*, never truthfulness — correctly out of our scope. | None for us; consider a documentation note stating this boundary explicitly so tenants don't assume we proof identities. |

### Implementation Threats (T3–T9)

| # | Threat | Our exposure | Coverage | Gap |
|---|---|---|---|---|
| T3 | Code Injection via Credential Content | Attribute values are opaque strings passed through to the agent; never templated/executed by us. | Implicit (no templating engine touches claim values). | Not documented as a deliberate control. |
| T4 | Signature-Based Correlation | Applies to VC signing keys (agent-held), not our OIDC JWTs. | `OIDC-KEY-ROTATION.md` covers boundary-1 tokens well. | No coverage of VC-layer signature schemes' correlation properties (e.g., AnonCreds vs. non-ZKP formats). |
| T5 | Correlation via Status/Revocation Lookup | Verifier-side status checks happen at the agent/ledger; we don't proxy or cache them. | Not discussed. | Gap — no documented stance on revocation-check privacy (e.g., batching, private status list membership). |
| T6 | Signing Key Compromise and Mismanagement | Three distinct key materials, not one: our OIDC signing key (boundary 1), `ConnectorCredential.api_key` (boundary 2), and the agent's internal VC-issuance keys (boundary 5, invisible to us). | `OIDC-KEY-ROTATION.md` covers only the first. `ConnectorCredential.api_key` is encrypted at rest (AES-256-GCM) but has no documented rotation runbook. | **Gap** — no rotation/compromise runbook for `ConnectorCredential.api_key`, and no visibility/runbook for agent-held VC signing keys at all. |
| T7 | Tampering with Unprotected External Resources | Inbound webhook (boundary 3) authenticated by a static shared `X-Api-Key` per connector, not a per-payload HMAC. | Auth exists; HMAC-signed *outbound* webhooks are planned (not yet built) per ARCHITECTURE.md:628. | **Gap** — a leaked connector API key lets an attacker forge state-change webhooks (fake "issued"/"verified") without real cryptography. Outbound webhook integrity to consumers is not yet implemented at all. |
| T8 | Presentation Exchange Attacks (MITM, Replay, Spoofing) | PKCE + same-origin design covers boundary 1. DIDComm/OID4VP presentation replay is handled inside the agent. | Partial — good for our own auth flows. | Not discussed for the DIDComm/OID4VP exchange itself (delegated, but undocumented as such). |
| T9 | Inappropriate or Out-of-Context Credential Use | Verification profiles must reference a real issuance profile, constraining what can be requested against what was issued. | Good implicit mitigation (ARCHITECTURE.md "Credential Profiles"). | None significant. |

### Deployment Threats (T10–T20)

| # | Threat | Our exposure | Coverage | Gap |
|---|---|---|---|---|
| T10 | Identifier-Based Correlation | DIDComm connections are per-tenant, per-relationship rows (`CONNECTION.external_connection_id`, `their_did`), consistent with Aries pairwise-DID convention — an implicit mitigation inherited from protocol choice. OID4VCI/OID4VP (connectionless, post-MVP) has no equivalent concept. | Implicit mitigation for DIDComm MVP path; nothing for OID4VCI/VP. | **Gap** — never stated as a deliberate control; no policy for holder-identifier reuse once the connectionless path ships. Public verification-profile discovery + identifier reuse across verifiers is the concrete risk scenario, undocumented. |
| T11 | Untrustworthy User-Agent Software | Wallet is external, entirely out of our boundary. | N/A. | Correctly out of scope. |
| T12 | Excessive Data Disclosure | Profiles declare requested attributes explicitly (DIF Presentation Exchange). | Good implicit mitigation, not framed as a privacy control. | Consider stating this as deliberate. |
| T13 | Metadata-Based Correlation | Not addressed. | — | Gap, likely low priority pre-scale. |
| T14 | Bearer Credential Reuse and Correlation | N/A for AnonCreds/SD-JWT (holder-binding); undiscussed for mDL/bearer-style formats. | — | Gap once Credo/mDL profiles ship. |
| T15 | Correlation via Patterns of Use | Not addressed. | — | Gap, platform-level (would need cross-tenant traffic-pattern analysis, likely post-MVP). |
| T16 | Disclosure to a Malicious or Deceptive Verifier | Public verification-profile discovery is documented; no tenant vetting process for who can register as a verifier. | — | Gap. |
| T17 | Data Theft and Credential Honeypots | `ConnectorCredential.api_key` is a concentrated target (boundary 2 — see §1.2). AES-256-GCM at rest, tenant isolation, rate limiting, audit trail all documented. | Strong coverage for storage/tenant isolation. | Add explicit callout that `ConnectorCredential.api_key` compromise = full tenant-Traction impersonation, and confirm rotation path exists. |
| T18 | Issuer-Side Correlation and Privacy Subversion | We (as part of C1) see all tenant issuance data by design — necessary for the platform's operation. | Not addressed as a privacy control. | Gap — no documented stance on internal-observer correlation risk (distinct from cross-tenant leakage, which *is* covered). |
| T19 | Inappropriate Validity Periods | Our own token TTLs (access/ID/refresh) are well documented in `OIDC-KEY-ROTATION.md`. VC credential validity periods (`credentialSubject` expiry) are agent/profile-level and undiscussed. | Partial — boundary 1 only. | Gap for boundary 5 (VC validity periods). |
| T20 | Device Theft and Impersonation | Concerns the holder's device running [bc-wallet-mobile](https://github.com/bcgov/bc-wallet-mobile), entirely outside our boundary. | N/A. | Correctly out of scope for this service; belongs to the bc-wallet-mobile threat model. |

### External Threats (T21–T24)

Storage-provider data mining, device fingerprinting, credential/data
aggregation, and post-presentation misuse are concerns of the wallet
([bc-wallet-mobile](https://github.com/bcgov/bc-wallet-mobile)) or the
verifier org, correctly out of scope for a backend orchestration service. Our
own analogous concern — tenant log data isolation — **is** addressed, in
`tenant-observability-design.md` (per-tenant Loki `X-Scope-OrgID` scoping,
enforced server-side from the validated JWT + `ConnectorCredential` lookup,
never from a client-supplied parameter).

### Dependency Threats (T25)

| # | Threat | Our exposure | Coverage | Gap |
|---|---|---|---|---|
| T25 | Cryptographic Suite Obsolescence | Covered for our OIDC JWTs (`OIDC-KEY-ROTATION.md`: RSA/RS256 only, no crypto agility beyond RSA — itself a smaller instance of this threat). No coverage of VC-layer suites (AnonCreds link-secret scheme, SD-JWT algs, mDL/mdoc COSE) or a deprecation plan for them. | Partial (boundary 1 only). | Gap — no VC-layer crypto-agility or deprecation plan; ownership sits with the agent, but we have no documented dependency-tracking process for it. |

---

## 3. Priority findings

Ordered by how concentrated the blast radius is, not by VCDM threat number:

1. **`ConnectorCredential.api_key` (boundary 2) has no rotation/compromise runbook** (T6, T17). This is the single highest-value secret in the system — compromise means full impersonation of a tenant's Traction sub-wallet. `OIDC-KEY-ROTATION.md` is a good model to replicate for it.
2. **Inbound webhook auth is a static shared secret, not payload-signed** (T1, T7). A leaked connector API key lets an attacker forge issuance/verification state without touching real cryptography, and we have no independent re-verification step.
3. **Outbound webhook signing (HMAC to consumers) is designed but not implemented.** Until `WebhookDispatchWorker` actually delivers, tenants relying on webhooks for authoritative results have no integrity guarantee at all — track this as a blocking item before enabling webhooks in production.
4. **Identifier-reuse policy (T10/T14) is undocumented and untested for the OID4VCI/OID4VP path.** MVP's DIDComm-only design inherits pairwise-DID privacy properties for free; that free lunch ends when Credo ships.
5. **No documented stance on VC-layer cryptographic agility (T25)** or on VC signing-key custody at the agent (T6, boundary 5) — both are delegated by design, but "delegated" should be a stated decision, not a silent gap.

---

## 4. References

- [Verifiable Credentials Data Model Threat Model v2.1](https://www.w3.org/TR/vc-data-model-threat-model-2.1/) — W3C Group Note Draft
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system context, adapter layer, Security Considerations
- [bcgov/bc-wallet-mobile](https://github.com/bcgov/bc-wallet-mobile) — the E2 Holder / C2 Holder System in this deployment; out of scope here but referenced for T20 and boundary 5
- [OIDC-KEY-ROTATION.md](./OIDC-KEY-ROTATION.md) — boundary-1 key rotation runbook
- [tenant-observability-design.md](./tenant-observability-design.md) — tenant log isolation (T18/T21 adjacent)
