import { CredentialExchange } from '../credential-exchange/credential-exchange.entity';

import {
  operationSteps,
  OperationStepState as State,
  OperationStepType as Type,
} from './operation-steps';
import { OPERATION_TYPE } from './operation-type.constants';
import { Operation, OperationState } from './operation.entity';

const operation = (overrides: Partial<Operation> = {}): Operation =>
  Object.assign(new Operation(), {
    type: OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER,
    state: OperationState.PROCESSING,
    request: { body: { options: { format: 'anoncreds' } } },
    ...overrides,
  });

describe('operation steps', () => {
  it.each([
    ['preflight', [State.PROCESSING, State.PENDING, State.PENDING]],
    ['schema_publication', [State.PROCESSING, State.PENDING, State.PENDING]],
    [
      'awaiting_schema_endorsement',
      [State.WAITING, State.PENDING, State.PENDING],
    ],
    [
      'awaiting_schema_discovery',
      [State.WAITING, State.PENDING, State.PENDING],
    ],
    ['definition_lookup', [State.COMPLETED, State.PROCESSING, State.PENDING]],
    [
      'awaiting_definition_endorsement',
      [State.COMPLETED, State.WAITING, State.PENDING],
    ],
    [
      'revocation_verification',
      [State.COMPLETED, State.COMPLETED, State.PROCESSING],
    ],
    [
      'awaiting_revocation_registry',
      [State.COMPLETED, State.COMPLETED, State.WAITING],
    ],
  ])('projects registration stage %s', (stage, states) => {
    const steps = operationSteps(
      operation({ result: { registration: { stage } } }),
    );
    expect(steps.map((step) => step.type)).toEqual([
      Type.SCHEMA_REGISTER,
      Type.CREDENTIAL_DEFINITION_REGISTER,
      Type.REVOCATION_SETUP,
    ]);
    expect(steps.map((step) => step.state)).toEqual(states);
  });

  it('marks the active registration step failed, not later steps', () => {
    expect(
      operationSteps(
        operation({
          state: OperationState.FAILED,
          result: { registration: { stage: 'definition_publication' } },
        }),
      ).map((step) => step.state),
    ).toEqual([State.COMPLETED, State.FAILED, State.PENDING]);
  });

  it('skips disabled revocation and completes applicable registration steps', () => {
    const input = operation({
      state: OperationState.COMPLETED,
      request: {
        method: 'POST',
        path: '',
        body: {
          options: {
            format: 'anoncreds',
            status: { revocation: { enabled: false } },
          },
        },
      },
    });
    expect(operationSteps(input).map((step) => step.state)).toEqual([
      State.COMPLETED,
      State.COMPLETED,
      State.SKIPPED,
    ]);
  });

  it('does not imply AnonCreds setup for other formats', () => {
    expect(
      operationSteps(
        operation({
          state: OperationState.COMPLETED,
          request: {
            method: 'POST',
            path: '',
            body: { options: { format: 'jwt_vc_json' } },
          },
        }),
      ),
    ).toEqual([
      { type: Type.CREDENTIAL_DEFINITION_REGISTER, state: State.COMPLETED },
    ]);
  });

  it.each([
    OPERATION_TYPE.PRESENTATION_DEFINITION_CREATE,
    OPERATION_TYPE.PRESENTATION_DEFINITION_UPDATE,
    OPERATION_TYPE.PRESENTATION_DEFINITION_PUBLISH,
    OPERATION_TYPE.PRESENTATION_DEFINITION_DEPRECATE,
    OPERATION_TYPE.ISSUANCE_PROFILE_CREATE,
    OPERATION_TYPE.ISSUANCE_PROFILE_UPDATE,
    OPERATION_TYPE.ISSUANCE_PROFILE_PUBLISH,
    OPERATION_TYPE.ISSUANCE_PROFILE_DEPRECATE,
  ])('represents local mutation %s as one completed step', (type) => {
    expect(
      operationSteps(operation({ type, state: OperationState.COMPLETED })),
    ).toEqual([{ type, state: State.COMPLETED }]);
  });

  it.each([
    [OperationState.PENDING, 0, [State.PENDING, State.PENDING, State.PENDING]],
    [
      OperationState.PROCESSING,
      1,
      [State.COMPLETED, State.WAITING, State.PENDING],
    ],
    [
      OperationState.PROCESSING,
      2,
      [State.COMPLETED, State.COMPLETED, State.PROCESSING],
    ],
    [OperationState.FAILED, 0, [State.FAILED, State.PENDING, State.PENDING]],
    [OperationState.FAILED, 1, [State.COMPLETED, State.FAILED, State.PENDING]],
    [
      OperationState.FAILED,
      2,
      [State.COMPLETED, State.COMPLETED, State.FAILED],
    ],
    [
      OperationState.COMPLETED,
      2,
      [State.COMPLETED, State.COMPLETED, State.COMPLETED],
    ],
  ])(
    'projects presentation %s from persisted stage %s',
    (state, presentationStage, states) => {
      const steps = operationSteps(
        operation({
          type: OPERATION_TYPE.PRESENTATION_REQUEST,
          state,
          presentationStage,
        }),
      );
      expect(steps.map((step) => step.type)).toEqual([
        Type.PRESENTATION_REQUEST_SEND,
        Type.PRESENTATION_RECEIVE,
        Type.PRESENTATION_VERIFY,
      ]);
      expect(steps.map((step) => step.state)).toEqual(states);
    },
  );

  it.each([
    ['pending', [State.PROCESSING, State.PENDING, State.PENDING]],
    ['offer-sent', [State.COMPLETED, State.WAITING, State.PENDING]],
    ['request-received', [State.COMPLETED, State.COMPLETED, State.WAITING]],
  ])(
    'projects issuance exchange %s without completing its parent',
    (state, states) => {
      const input = operation({
        type: OPERATION_TYPE.CREDENTIAL_OFFER,
        exchange: Object.assign(new CredentialExchange(), { state }),
      });
      expect(operationSteps(input).map((step) => step.state)).toEqual(states);
      expect(input.state).toBe(OperationState.PROCESSING);
    },
  );

  it('completes issuance steps only at terminal success', () => {
    expect(
      operationSteps(
        operation({
          type: OPERATION_TYPE.CREDENTIAL_OFFER,
          state: OperationState.COMPLETED,
        }),
      ).map((step) => step.state),
    ).toEqual([State.COMPLETED, State.COMPLETED, State.COMPLETED]);
  });

  it('does not guess which step failed from an abandoned exchange', () => {
    expect(
      operationSteps(
        operation({
          type: OPERATION_TYPE.CREDENTIAL_OFFER,
          state: OperationState.FAILED,
          exchange: Object.assign(new CredentialExchange(), {
            state: 'abandoned',
          }),
        }),
      ).map((step) => step.state),
    ).toEqual([State.PENDING, State.PENDING, State.PENDING]);
  });

  it('keeps batch items separate from workflow steps', () => {
    expect(
      operationSteps(
        operation({ type: OPERATION_TYPE.CREDENTIAL_OFFER_BATCH }),
      ),
    ).toEqual([]);
  });

  it.each(['unknown.operation', 'toString', '__proto__'])(
    'does not invent steps for unsupported type %s',
    (type) => {
      expect(operationSteps(operation({ type }))).toEqual([]);
    },
  );
});
