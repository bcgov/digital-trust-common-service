---
name: digital-trust-api
description: "Operate the Digital Trust API safely: onboard tenants and clients, configure Traction connectors, register AnonCreds artifacts, manage connections, issue credentials, request presentations, and check revocation prerequisites."
argument-hint: "Describe the approved operation, target environment, tenant, and exact resource IDs without including secrets."
---
# Digital Trust API Operations

## When to Use

Use this skill for authorized API operations, not deployment changes or direct
database repair. Keep local working material under `.skills/` local-only and out
of commits; never copy credentials or environment snapshots into this guide.

## Safety and Contract Discovery

1. Inspect the target deployment's live OpenAPI before selecting a route, API
   version, request body, response shape, or scope. Compare the relevant controller
   and DTO contracts in the matching source revision when available. Repository
   documentation and branch code do not prove a feature is deployed.
2. Confirm the environment and authenticated principal. Use least privilege:
   platform administration only for platform tasks, tenant-scoped credentials for
   tenant tasks. Match the token's tenant to every tenant route and resource.
3. Before any write, obtain explicit user authorization for the exact target IDs,
   intended payload, and effects, including external messages and ledger writes.
   Resolve names through reads; never treat a display name as an identifier.
4. Keep secrets in an approved store outside the repository. Never echo tokens,
   client secrets, wallet credentials, personal attributes, or sensitive payloads
   into chat, logs, command history, or committed files.
5. On asynchronous acceptance, retain the returned Operation ID securely and poll
   its tenant-scoped status to a terminal outcome with bounded backoff. Acceptance
   is not completion. Inspect errors and result IDs, then read the result resource.
6. Never blind-retry a timed-out or uncertain write. First query the Operation,
   resource, and connector state; use a documented reconciliation action when
   supported. If the outcome remains uncertain, stop and report it rather than
   creating duplicate resources, transactions, or messages.

## Operating Procedure

1. **Tenant and owner/client onboarding.** Read existing tenants and memberships
   before creating anything. Confirm the intended owner identity and tenant, then
   use the deployed onboarding contract. Create machine clients only with the
   approved tenant, grant types, audience, and minimal scopes; retain returned
   secrets securely. Verify the resulting membership and client access without
   granting platform privileges to work around an authorization failure.
2. **Traction connector setup.** Verify the authenticated wallet identity and
   supported wallet capabilities using the companion `traction-sandbox-controller`
   skill. Configure only the approved tenant's connector through supported API
   fields. Verify connectivity and capability reporting without exposing stored
   credentials; do not assume a reachable agent is the correct wallet.
3. **AnonCreds schema and definition registration.** Confirm an
   `askar-anoncreds` wallet, the intended ledger and public issuer DID, endorser
   readiness, and applicable transaction author agreement (TAA) requirements.
   Inspect the deployed registration contract and existing ledger artifacts before
   submitting approved schema attributes, version, tag, or revocation options.
   Follow the returned Operation through completion and verify external artifact
   IDs. Recovery must first look up the existing artifact or transaction and use
   supported reconciliation; never resubmit an uncertain ledger write or change
   schema identity merely to bypass an error.
4. **Connection invitation and reconciliation.** Confirm connector, tenant,
   invitation direction, and single-use or multi-use intent. Create or accept an
   invitation only as approved, then check both service and agent state. A
   multi-use invitation template is not a particular holder connection. Use the
   deployed reconciliation contract to resolve stale state; do not recreate an
   invitation or connection solely because a webhook is delayed.
5. **Credential offers and explicit issuance.** Confirm the exact connection,
   issuance profile, credential definition, attributes, and revocation policy.
   Send an offer only with approval. An offer is not an instruction to issue:
   inspect the exchange state and require explicit authorization for the
   supported issuance action. Poll each asynchronous Operation and inspect the
   exchange. Issuer-side success does not prove receipt or storage in the holder
   wallet; report those as separate outcomes with separate evidence.
6. **Exchange status and reconciliation.** Read the persisted exchange and its
   Operations before acting. Reconcile only the exact tenant, connector, exchange,
   and protocol type through supported routes. A shared external identifier is
   not sufficient evidence that two protocol operations are the same.
7. **Verification profiles and presentation requests.** Confirm the deployed
   format, restrictions, requested attributes or predicates, and exact connection.
   Review the approved verification profile before creating a request. Apply the
   connected-presentation gate below before sending. Poll and inspect verification
   results; distinguish delivery, presentation receipt, cryptographic verification,
   and policy acceptance.
8. **Revocation prerequisites.** Confirm the exact issued credential, issuer
   wallet, format support, revocation-enabled definition, registry capacity and
   state, required tails availability, and ledger/endorsement readiness. Revocation
   is an explicitly authorized write, not a cleanup action. Poll completion and
   verify published revocation state; do not claim immediate holder awareness.

## Connected Presentation Preservation Gate

ACA-Py 1.6.x connected present-proof send-request ignores
`auto_remove_on_failure`. The fail-closed verifier implementation therefore checks
the authenticated wallet's `GET /settings` before **each** connected `POST` and
requires the top-level boolean `no_preserve_failed_exchange_records` to be
`false`. Missing, `true`, non-boolean, inaccessible, or forbidden values block the
write. `preserve_exchange_records: true` alone is not sufficient.

Stock ACA-Py 1.6.0 hides this setting, so the gate blocks unless the deployment
exposes its effective value through a wallet-scoped read-only surface. Do not use
root `/status/config`, change configuration, or fall back to a connectionless
request. The preflight is implemented and pushed on a draft feature branch.
GitHub reports it mergeable with all six CI checks passing; it remains open,
draft, and unmerged, and is not necessarily deployed. Passing checks do not
establish runtime availability. Verify the current implementation status,
deployed OpenAPI, and connector support before using it.

## Reporting

Report only non-sensitive status, verified outcomes, and unresolved uncertainty.
Keep exact operational IDs in approved local records, not reusable documentation.
Never describe a pending Operation, an issuer-side result, or unverified deployment
capability as end-to-end success.
