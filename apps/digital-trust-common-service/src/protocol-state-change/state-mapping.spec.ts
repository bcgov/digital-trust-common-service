import { ConnectionState } from '../connection/connection.entity';
import { CredentialState } from '../credential/credential.entity';
import { OperationState } from '../operation/operation.entity';

import {
  connectionStatesBelow,
  credentialStatesBelow,
  isForwardConnectionTransition,
  isForwardCredentialTransition,
  isForwardOperationTransition,
  operationStatesBelow,
  ProtocolTopic,
  resolveProtocolOutcome,
  TOPIC_OPERATION_TYPES,
} from './state-mapping';

describe('state-mapping', () => {
  describe('isForwardOperationTransition', () => {
    it('allows pending -> processing', () => {
      expect(
        isForwardOperationTransition(
          OperationState.PENDING,
          OperationState.PROCESSING,
        ),
      ).toBe(true);
    });

    it('rejects completed -> processing (regression)', () => {
      expect(
        isForwardOperationTransition(
          OperationState.COMPLETED,
          OperationState.PROCESSING,
        ),
      ).toBe(false);
    });

    it('rejects a same-rank terminal-to-terminal move (failed -> completed)', () => {
      expect(
        isForwardOperationTransition(
          OperationState.FAILED,
          OperationState.COMPLETED,
        ),
      ).toBe(false);
    });
  });

  describe('isForwardCredentialTransition', () => {
    it('allows offered -> issued', () => {
      expect(
        isForwardCredentialTransition(
          CredentialState.OFFERED,
          CredentialState.ISSUED,
        ),
      ).toBe(true);
    });

    it('rejects revoked -> issued (regression)', () => {
      expect(
        isForwardCredentialTransition(
          CredentialState.REVOKED,
          CredentialState.ISSUED,
        ),
      ).toBe(false);
    });

    it('allows offered -> failed (issuance never succeeded)', () => {
      expect(
        isForwardCredentialTransition(
          CredentialState.OFFERED,
          CredentialState.FAILED,
        ),
      ).toBe(true);
    });

    it('rejects issued -> failed (a delayed/out-of-order abandoned webhook must not overwrite an already-issued credential)', () => {
      expect(
        isForwardCredentialTransition(
          CredentialState.ISSUED,
          CredentialState.FAILED,
        ),
      ).toBe(false);
    });

    it('rejects offered -> revoked (nothing to revoke until issued)', () => {
      expect(
        isForwardCredentialTransition(
          CredentialState.OFFERED,
          CredentialState.REVOKED,
        ),
      ).toBe(false);
    });
  });

  describe('isForwardConnectionTransition', () => {
    it('allows invited -> active', () => {
      expect(
        isForwardConnectionTransition(
          ConnectionState.INVITED,
          ConnectionState.ACTIVE,
        ),
      ).toBe(true);
    });

    it('rejects active -> requested (regression)', () => {
      expect(
        isForwardConnectionTransition(
          ConnectionState.ACTIVE,
          ConnectionState.REQUESTED,
        ),
      ).toBe(false);
    });
  });

  describe('operationStatesBelow', () => {
    it('returns every state ranked below the target', () => {
      expect(new Set(operationStatesBelow(OperationState.PROCESSING))).toEqual(
        new Set([OperationState.PENDING]),
      );
      expect(new Set(operationStatesBelow(OperationState.COMPLETED))).toEqual(
        new Set([OperationState.PENDING, OperationState.PROCESSING]),
      );
    });

    it('returns an empty set for the lowest-ranked state', () => {
      expect(operationStatesBelow(OperationState.PENDING)).toEqual([]);
    });
  });

  describe('credentialStatesBelow', () => {
    it('returns only the states that may legitimately precede the target', () => {
      expect(new Set(credentialStatesBelow(CredentialState.ISSUED))).toEqual(
        new Set([CredentialState.OFFERED]),
      );
      expect(new Set(credentialStatesBelow(CredentialState.REVOKED))).toEqual(
        new Set([CredentialState.ISSUED]),
      );
    });

    it('restricts FAILED to pre-issuance (OFFERED) only, excluding ISSUED', () => {
      expect(new Set(credentialStatesBelow(CredentialState.FAILED))).toEqual(
        new Set([CredentialState.OFFERED]),
      );
    });

    it('returns an empty set for the lowest-ranked state', () => {
      expect(credentialStatesBelow(CredentialState.OFFERED)).toEqual([]);
    });
  });

  describe('connectionStatesBelow', () => {
    it('returns every state ranked below the target', () => {
      expect(new Set(connectionStatesBelow(ConnectionState.ACTIVE))).toEqual(
        new Set([
          ConnectionState.INVITED,
          ConnectionState.REQUESTED,
          ConnectionState.RESPONDED,
        ]),
      );
    });

    it('returns an empty set for the lowest-ranked state', () => {
      expect(connectionStatesBelow(ConnectionState.INVITED)).toEqual([]);
    });
  });

  describe('TOPIC_OPERATION_TYPES', () => {
    it('assigns no Operation type to more than one topic', () => {
      const seen = new Map<string, ProtocolTopic>();

      for (const [topic, types] of Object.entries(TOPIC_OPERATION_TYPES) as [
        ProtocolTopic,
        readonly string[],
      ][]) {
        for (const type of types) {
          expect(seen.has(type)).toBe(false);
          seen.set(type, topic);
        }
      }
    });
  });

  describe('resolveProtocolOutcome', () => {
    it('maps issue_credential credential-issued to Credential ISSUED / Operation COMPLETED', () => {
      const outcome = resolveProtocolOutcome(
        'issue_credential',
        'credential-issued',
      );

      expect(outcome).toEqual({
        operationState: OperationState.COMPLETED,
        credentialState: CredentialState.ISSUED,
        event: 'credential.issued',
      });
    });

    it('maps the underscore-separated wire form ACA-Py/Traction actually sends (credential_issued) the same as the hyphenated form', () => {
      const outcome = resolveProtocolOutcome(
        'issue_credential',
        'credential_issued',
      );

      expect(outcome).toEqual({
        operationState: OperationState.COMPLETED,
        credentialState: CredentialState.ISSUED,
        event: 'credential.issued',
      });
    });

    it('maps issue_credential abandoned to Credential FAILED / Operation FAILED', () => {
      const outcome = resolveProtocolOutcome('issue_credential', 'abandoned');

      expect(outcome).toEqual({
        operationState: OperationState.FAILED,
        credentialState: CredentialState.FAILED,
        event: 'credential.rejected',
      });
    });

    it('maps a known non-terminal issue_credential state to Operation PROCESSING only', () => {
      const outcome = resolveProtocolOutcome('issue_credential', 'offer-sent');

      expect(outcome).toEqual({ operationState: OperationState.PROCESSING });
    });

    it('maps the underscore-separated wire form of a non-terminal issue_credential state (offer_sent) the same as the hyphenated form', () => {
      const outcome = resolveProtocolOutcome('issue_credential', 'offer_sent');

      expect(outcome).toEqual({ operationState: OperationState.PROCESSING });
    });

    it('returns null for an unrecognized issue_credential state', () => {
      expect(
        resolveProtocolOutcome('issue_credential', 'not-a-real-state'),
      ).toBeNull();
    });

    it('maps present_proof verified to Operation COMPLETED with no credential state', () => {
      const outcome = resolveProtocolOutcome('present_proof', 'verified');

      expect(outcome).toEqual({
        operationState: OperationState.COMPLETED,
        event: 'credential.verified',
      });
    });

    it('maps the underscore-separated wire form of a non-terminal present_proof state (request_sent) the same as the hyphenated form', () => {
      const outcome = resolveProtocolOutcome('present_proof', 'request_sent');

      expect(outcome).toEqual({ operationState: OperationState.PROCESSING });
    });

    it('maps present_proof abandoned to Operation FAILED with no event', () => {
      const outcome = resolveProtocolOutcome('present_proof', 'abandoned');

      expect(outcome).toEqual({ operationState: OperationState.FAILED });
    });

    it('maps connections active to Connection ACTIVE / Operation COMPLETED / connection.established', () => {
      const outcome = resolveProtocolOutcome('connections', 'active');

      expect(outcome).toEqual({
        operationState: OperationState.COMPLETED,
        connectionState: ConnectionState.ACTIVE,
        event: 'connection.established',
      });
    });

    it('maps connections completed to Connection COMPLETED / Operation COMPLETED with no event, so a later completed webhook does not re-emit connection.established', () => {
      const outcome = resolveProtocolOutcome('connections', 'completed');

      expect(outcome).toEqual({
        operationState: OperationState.COMPLETED,
        connectionState: ConnectionState.COMPLETED,
      });
      expect(outcome?.event).toBeUndefined();
    });

    it('maps connections error to Connection ABANDONED / Operation FAILED', () => {
      const outcome = resolveProtocolOutcome('connections', 'error');

      expect(outcome).toEqual({
        operationState: OperationState.FAILED,
        connectionState: ConnectionState.ABANDONED,
      });
    });

    it('maps connections invitation to a non-terminal PROCESSING outcome', () => {
      const outcome = resolveProtocolOutcome('connections', 'invitation');

      expect(outcome).toEqual({
        operationState: OperationState.PROCESSING,
        connectionState: ConnectionState.INVITED,
      });
    });

    it('returns null for an unrecognized connections state', () => {
      expect(resolveProtocolOutcome('connections', 'bogus')).toBeNull();
    });

    it('maps revocation_registry to Credential REVOKED / Operation COMPLETED', () => {
      const outcome = resolveProtocolOutcome('revocation_registry', 'revoked');

      expect(outcome).toEqual({
        operationState: OperationState.COMPLETED,
        credentialState: CredentialState.REVOKED,
        event: 'credential.revoked',
      });
    });
  });
});
