---
name: traction-sandbox-controller
description: "Operate an approved Traction sandbox wallet safely, verifying wallet identity, AnonCreds readiness, issuer DID and ledger state, endorsement progress, and connected presentation prerequisites."
argument-hint: "Describe the approved wallet operation and target environment without including credentials or personal data."
---
# Traction Sandbox Controller Operations

## When to Use

Use this skill for explicitly approved Traction sandbox controller operations.
It does not authorize provisioning, wallet migration, ledger changes, or
configuration changes on its own.

## Safety and Discovery

1. Obtain explicit user approval before provisioning or any other write. Confirm
   the environment, exact wallet and resource IDs, intended payload, and external
   effects. Use deployment-supplied endpoints rather than assuming a sandbox URL.
2. Inspect the deployed controller and agent OpenAPI for routes, authentication,
   DTOs, protocol versions, and capabilities. A repository branch or prior
   deployment does not establish current availability.
3. Retain provisioning and authentication credentials in an approved secure store
   outside the repository. Do not put secret values, secret-store paths, wallet
   snapshots, or sensitive response bodies into documentation, logs, or chat.
4. Authenticate with wallet-scoped credentials and verify the returned wallet
   identity matches the approved wallet before every workflow. A successful
   health check or root-agent response does not establish wallet identity.
5. Never silently upgrade or replace a wallet, switch ledgers, create duplicate
   DIDs or transactions, or use fixed seeds. If a prerequisite is missing, report
   the blocker and seek approval for a separate remediation operation.

## Wallet and Issuer Readiness

1. Verify the effective wallet type is exactly `askar-anoncreds` before AnonCreds
   operations. A generic Askar wallet, a wallet name, or an available endpoint is
   not proof of readiness. Do not migrate a legacy wallet as an incidental fix.
2. Read the selected ledger/network, read/write availability, issuer DID state,
   endorser connection and role, and effective TAA requirements before proposing
   changes. Confirm any required TAA acceptance is authorized and satisfies the
   deployment's policy; do not accept agreements automatically.
3. Distinguish three separate states: a DID created inside the wallet, a NYM
   registered on the intended ledger, and a DID assigned as the wallet's public
   DID. None proves the other two. Verify each required state through the
   wallet-scoped API and ledger reads before schema or definition registration.
4. The tested legacy Indy SOV issuer path is deployment-specific, not a universal
   Traction or AnonCreds prerequisite. Use it only when the target deployment's
   ledger, DID method, endorser, and public-DID contract require and support it.
   Do not substitute another ledger or DID method to make a workflow appear ready.

## Ledger Writes and Recovery

1. Before an approved DID registration, schema, credential definition, or
   revocation write, read existing wallet records, ledger artifacts, and pending
   transactions. Confirm exact ownership, identifiers, schema attributes/version,
   and definition options; reuse verified existing artifacts where supported.
2. Use only the deployed author/endorser workflow. Distinguish transaction
   preparation, endorsement request, endorsement completion, submission, and
   ledger publication; a successful HTTP response may cover only one stage.
3. Retain returned transaction identifiers securely. Poll transactions and
   endorsements with bounded backoff, inspect explicit failures, and verify the
   resulting artifact on the intended ledger before reporting success.
4. After a timeout or ambiguous result, query transaction, wallet, and ledger
   state before any retry. Reconcile through supported read/recovery surfaces.
   Never regenerate a DID or duplicate a ledger transaction merely because its
   response was lost. Stop with an explicit uncertain outcome if reads cannot
   establish whether the write occurred.

## Connected Presentation Preservation Gate

ACA-Py 1.6.x connected present-proof send-request ignores
`auto_remove_on_failure`. The fail-closed verifier implementation checks the
authenticated wallet's `GET /settings` before **each** connected `POST`.
Proceed only when the top-level `no_preserve_failed_exchange_records` value is
the boolean `false`. Missing, `true`, non-boolean, inaccessible, or forbidden
values block the write; `preserve_exchange_records: true` alone is insufficient.

Stock ACA-Py 1.6.0 hides the setting and therefore blocks unless the deployment
exposes its effective value through a wallet-scoped read-only surface. Do not
read root `/status/config`, write configuration, or substitute a connectionless
request. The preflight is implemented and pushed on a draft feature branch.
GitHub reports it mergeable with all six CI checks passing; it remains open,
draft, and unmerged, and is not necessarily deployed. Passing checks do not
establish runtime availability. Verify the current implementation status,
deployed OpenAPI, and connector support before using it.

## Outcome Checks

Verify connection and protocol exchange states in the authenticated wallet, not
only the controller's cached view. Distinguish issuer-side completion from holder
wallet receipt, and presentation delivery from verified proof acceptance. Report
pending or uncertain states explicitly. Keep credentials, personal attributes,
exact operational IDs, environment snapshots, and one-off test narratives out of
reusable guides and commits.
