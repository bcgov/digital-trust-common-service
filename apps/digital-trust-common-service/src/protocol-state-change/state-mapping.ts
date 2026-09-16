import {
  ConnectionState as AgentConnectionState,
  CredentialExchangeState,
  PresentationExchangeState,
} from '@app/credential-ports';

import { ConnectionState } from '../connection/connection.entity';
import { CredentialState } from '../credential/credential.entity';
import {
  OPERATION_TYPE,
  OperationType,
} from '../operation/operation-type.constants';
import { OperationState } from '../operation/operation.entity';

/**
 * The webhook topics ACA-Py/Traction (and, in future, Credo) deliver.
 * Named `topic` rather than `protocol` since it's the raw wire field name;
 * `issue_credential`, `present_proof`, `connections`, and
 * `revocation_registry` are each Aries RFC "protocols" — hence this module's
 * name, `protocol-state-change` — but the state carried by each event is
 * unrelated to `ConnectionProtocol` (didcomm-v1/v2/openid4vc), which
 * describes the wire format a connection uses, not a state transition.
 */
export type ProtocolTopic =
  'issue_credential' | 'present_proof' | 'connections' | 'revocation_registry';

/**
 * The Operation types a given topic's webhook is allowed to correlate to.
 * `externalId` is not unique across an Operation's lifetime: CredentialAction
 * (accept/reject) and CredentialRevoke both deliberately create a new
 * Operation reusing the original credential exchange's externalId (see
 * OperationRepository.findByExternalIdForTenant's docstring), so more than
 * one in-flight Operation can share the same tenantId/externalId pair at
 * once, but for *different* protocols. Without this predicate, a delayed or
 * retried issue_credential webhook could match a since-created
 * credential.revoke Operation (same externalId, still PENDING) and drive it
 * to COMPLETED with issuance data instead of ever completing the actual
 * revocation. Scoping the lookup to only the types a topic's protocol can
 * legitimately produce keeps same-topic ambiguity (offer vs. its own
 * accept/reject) resolvable by recency, while making cross-topic collisions
 * simply no match — the same safe fallback as no Operation being linked at
 * all.
 */
export const TOPIC_OPERATION_TYPES: Record<
  ProtocolTopic,
  readonly OperationType[]
> = {
  issue_credential: [
    OPERATION_TYPE.CREDENTIAL_OFFER,
    OPERATION_TYPE.CREDENTIAL_OFFER_BATCH,
    OPERATION_TYPE.CREDENTIAL_ACCEPT,
    OPERATION_TYPE.CREDENTIAL_REJECT,
  ],
  revocation_registry: [
    OPERATION_TYPE.CREDENTIAL_REVOKE,
    OPERATION_TYPE.CREDENTIAL_REVOKE_BATCH,
  ],
  present_proof: [OPERATION_TYPE.PRESENTATION_REQUEST],
  connections: [OPERATION_TYPE.CONNECTION_CREATE],
};

export type DomainEventName =
  | 'credential.accepted'
  | 'credential.issued'
  | 'credential.verified'
  | 'credential.rejected'
  | 'credential.revoked'
  | 'connection.established';

export interface ProtocolOutcome {
  readonly operationState: OperationState;
  readonly credentialState?: CredentialState;
  readonly connectionState?: ConnectionState;
  readonly event?: DomainEventName;
}

const OPERATION_STATE_RANK: Record<OperationState, number> = {
  [OperationState.PENDING]: 0,
  [OperationState.PROCESSING]: 1,
  [OperationState.COMPLETED]: 2,
  [OperationState.FAILED]: 2,
};

/**
 * Credential states don't form a single total order: FAILED, REVOKED, and
 * EXPIRED are parallel terminal branches, not all reachable from every state
 * ranked below them. A linear rank (as used for Operation/Connection below)
 * would let a delayed/out-of-order `abandoned` webhook match an already-
 * ISSUED credential — since FAILED and ISSUED would share "rank 2" — and
 * overwrite it as FAILED, emitting `credential.rejected` for a credential
 * that already succeeded. Each target state instead lists exactly the prior
 * states a forward transition into it may legitimately come from:
 * - ISSUED only ever follows an OFFERED credential actually being issued.
 * - FAILED is issuance failing before it ever succeeded, so only OFFERED is
 *   a valid predecessor — never ISSUED, which must stay reachable only by
 *   REVOKED/EXPIRED, not overwritten as FAILED by a stale delivery.
 * - REVOKED requires the credential to have actually been ISSUED first.
 * - EXPIRED is an un-actioned offer timing out, so only OFFERED applies; it
 *   is not currently produced by resolveProtocolOutcome for any topic.
 */
const CREDENTIAL_ALLOWED_FROM_STATES: Record<
  CredentialState,
  readonly CredentialState[]
> = {
  [CredentialState.OFFERED]: [],
  [CredentialState.ISSUED]: [CredentialState.OFFERED],
  [CredentialState.FAILED]: [CredentialState.OFFERED],
  [CredentialState.REVOKED]: [CredentialState.ISSUED],
  [CredentialState.EXPIRED]: [CredentialState.OFFERED],
};

const CONNECTION_STATE_RANK: Record<ConnectionState, number> = {
  [ConnectionState.INVITED]: 0,
  [ConnectionState.REQUESTED]: 1,
  [ConnectionState.RESPONDED]: 2,
  [ConnectionState.ACTIVE]: 3,
  [ConnectionState.COMPLETED]: 4,
  [ConnectionState.ABANDONED]: 4,
};

/** True when `to` is strictly ahead of `from` — never regress */
export function isForwardOperationTransition(
  from: OperationState,
  to: OperationState,
): boolean {
  return OPERATION_STATE_RANK[to] > OPERATION_STATE_RANK[from];
}

export function isForwardCredentialTransition(
  from: CredentialState,
  to: CredentialState,
): boolean {
  return CREDENTIAL_ALLOWED_FROM_STATES[to].includes(from);
}

export function isForwardConnectionTransition(
  from: ConnectionState,
  to: ConnectionState,
): boolean {
  return CONNECTION_STATE_RANK[to] > CONNECTION_STATE_RANK[from];
}

/**
 * Every state with a strictly lower rank than `target` — the full set of
 * prior states a forward transition into `target` could legitimately come
 * from. Used to build an atomic `UPDATE ... WHERE state IN (...)` guard
 * instead of a read-then-check-then-write: pg-boss's at-least-once delivery
 * means the same webhook can be handled more than once concurrently, so
 * checking `isForwardOperationTransition(from, to)` against one in-memory
 * read and then writing separately lets two concurrent deliveries both pass
 * the check against the same stale read and both write (and both fire
 * audit/domain/webhook side effects). Conditioning the write on the full set
 * of valid prior states, re-checked by the database at write time rather
 * than the value this call happened to read earlier, makes only one
 * delivery's UPDATE actually match a row.
 */
export function operationStatesBelow(target: OperationState): OperationState[] {
  const targetRank = OPERATION_STATE_RANK[target];
  return (Object.values(OperationState) as OperationState[]).filter(
    (state) => OPERATION_STATE_RANK[state] < targetRank,
  );
}

/**
 * Unlike operationStatesBelow/connectionStatesBelow above, this isn't a
 * rank-based "everything below" set — see CREDENTIAL_ALLOWED_FROM_STATES for
 * why credential states need an explicit transition matrix instead of a
 * single linear rank.
 */
export function credentialStatesBelow(
  target: CredentialState,
): CredentialState[] {
  return [...CREDENTIAL_ALLOWED_FROM_STATES[target]];
}

export function connectionStatesBelow(
  target: ConnectionState,
): ConnectionState[] {
  const targetRank = CONNECTION_STATE_RANK[target];
  return (Object.values(ConnectionState) as ConnectionState[]).filter(
    (state) => CONNECTION_STATE_RANK[state] < targetRank,
  );
}

const ISSUE_CREDENTIAL_OUTCOMES: Partial<
  Record<CredentialExchangeState, ProtocolOutcome>
> = {
  [CredentialExchangeState.CredentialIssued]: {
    operationState: OperationState.COMPLETED,
    credentialState: CredentialState.ISSUED,
    event: 'credential.issued',
  },
  [CredentialExchangeState.Done]: {
    operationState: OperationState.COMPLETED,
    credentialState: CredentialState.ISSUED,
    event: 'credential.issued',
  },
  [CredentialExchangeState.Abandoned]: {
    operationState: OperationState.FAILED,
    credentialState: CredentialState.FAILED,
    event: 'credential.rejected',
  },
};

const PRESENT_PROOF_OUTCOMES: Partial<
  Record<PresentationExchangeState, ProtocolOutcome>
> = {
  [PresentationExchangeState.Verified]: {
    operationState: OperationState.COMPLETED,
    event: 'credential.verified',
  },
  [PresentationExchangeState.Done]: {
    operationState: OperationState.COMPLETED,
    event: 'credential.verified',
  },
  [PresentationExchangeState.Abandoned]: {
    operationState: OperationState.FAILED,
  },
};

const AGENT_TO_CONNECTION_STATE: Record<AgentConnectionState, ConnectionState> =
  {
    [AgentConnectionState.Invitation]: ConnectionState.INVITED,
    [AgentConnectionState.Request]: ConnectionState.REQUESTED,
    [AgentConnectionState.Response]: ConnectionState.RESPONDED,
    [AgentConnectionState.Active]: ConnectionState.ACTIVE,
    [AgentConnectionState.Completed]: ConnectionState.COMPLETED,
    [AgentConnectionState.Error]: ConnectionState.ABANDONED,
  };

/**
 * Resolves a raw, topic-scoped protocol state string into the target
 * Operation/Credential/Connection states and the domain event (if any) to
 * emit. Returns null when the state is unrecognized for its topic — the
 * caller should log and no-op rather than guess, since ACA-Py may introduce
 * states this service doesn't know about yet.
 */
export function resolveProtocolOutcome(
  topic: ProtocolTopic,
  protocolState: string,
): ProtocolOutcome | null {
  // ACA-Py/Traction webhooks send wire states underscore-separated (e.g.
  // `credential_issued`, `offer_sent` — see docs/ARCHITECTURE.md's webhook
  // payload examples), while credential-ports' exchange state enums —
  // this module's lookup keys — use hyphens (`credential-issued`,
  // `offer-sent`). Normalizing here means a raw wire value matches its
  // table entry regardless of which separator the caller passed; single-word
  // states (connections, revocation_registry) are unaffected.
  const normalizedState = protocolState.replace(/_/g, '-');

  switch (topic) {
    case 'issue_credential':
      return resolveFromTable(
        ISSUE_CREDENTIAL_OUTCOMES,
        Object.values(CredentialExchangeState),
        normalizedState,
      );
    case 'present_proof':
      return resolveFromTable(
        PRESENT_PROOF_OUTCOMES,
        Object.values(PresentationExchangeState),
        normalizedState,
      );
    case 'connections':
      return resolveConnectionsOutcome(normalizedState);
    case 'revocation_registry':
      return normalizedState === 'revoked'
        ? {
            operationState: OperationState.COMPLETED,
            credentialState: CredentialState.REVOKED,
            event: 'credential.revoked',
          }
        : null;
    default:
      return null;
  }
}

function resolveFromTable<T extends string>(
  table: Partial<Record<T, ProtocolOutcome>>,
  knownStates: readonly T[],
  protocolState: string,
): ProtocolOutcome | null {
  const outcome = table[protocolState as T];

  if (outcome) {
    return outcome;
  }

  if (!knownStates.includes(protocolState as T)) {
    return null;
  }

  // A known-but-non-terminal exchange state (e.g. offer-sent, request-sent):
  // the exchange is progressing but there's nothing terminal to apply yet.
  return { operationState: OperationState.PROCESSING };
}

function resolveConnectionsOutcome(
  protocolState: string,
): ProtocolOutcome | null {
  const mapped =
    AGENT_TO_CONNECTION_STATE[protocolState as AgentConnectionState];

  if (mapped === undefined) {
    return null;
  }

  if (mapped === ConnectionState.ABANDONED) {
    return { operationState: OperationState.FAILED, connectionState: mapped };
  }

  if (
    mapped === ConnectionState.ACTIVE ||
    mapped === ConnectionState.COMPLETED
  ) {
    return {
      operationState: OperationState.COMPLETED,
      connectionState: mapped,
      // Only ACTIVE is the connection actually being established; a
      // later `completed` webhook (ACTIVE -> COMPLETED) is a distinct,
      // subsequent transition and must not re-fire the same event.
      event:
        mapped === ConnectionState.ACTIVE
          ? 'connection.established'
          : undefined,
    };
  }

  return { operationState: OperationState.PROCESSING, connectionState: mapped };
}
