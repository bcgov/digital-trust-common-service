import { CredentialExchangeState } from '@app/credential-ports';

import { OPERATION_TYPE } from './operation-type.constants';
import { OperationState, type Operation } from './operation.entity';

export enum OperationStepType {
  SCHEMA_REGISTER = 'schema.register',
  CREDENTIAL_DEFINITION_REGISTER = 'credential-definition.register',
  REVOCATION_SETUP = 'revocation.setup',
  ISSUANCE_PROFILE_CREATE = 'issuance-profile.create',
  ISSUANCE_PROFILE_UPDATE = 'issuance-profile.update',
  ISSUANCE_PROFILE_PUBLISH = 'issuance-profile.publish',
  ISSUANCE_PROFILE_DEPRECATE = 'issuance-profile.deprecate',
  OFFER_SEND = 'credential-offer.send',
  HOLDER_REQUEST = 'credential-request.receive',
  CREDENTIAL_ISSUE = 'credential.issue',
}

export enum OperationStepState {
  PENDING = 'pending',
  PROCESSING = 'processing',
  WAITING = 'waiting',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export interface OperationStep {
  type: OperationStepType;
  state: OperationStepState;
}

const PROFILE_STEPS = new Map<string, OperationStepType>([
  [
    OPERATION_TYPE.ISSUANCE_PROFILE_CREATE,
    OperationStepType.ISSUANCE_PROFILE_CREATE,
  ],
  [
    OPERATION_TYPE.ISSUANCE_PROFILE_UPDATE,
    OperationStepType.ISSUANCE_PROFILE_UPDATE,
  ],
  [
    OPERATION_TYPE.ISSUANCE_PROFILE_PUBLISH,
    OperationStepType.ISSUANCE_PROFILE_PUBLISH,
  ],
  [
    OPERATION_TYPE.ISSUANCE_PROFILE_DEPRECATE,
    OperationStepType.ISSUANCE_PROFILE_DEPRECATE,
  ],
]);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sequence(
  types: OperationStepType[],
  active: number,
  state: OperationStepState,
): OperationStep[] {
  return types.map((type, index) => ({
    type,
    state:
      index < active
        ? OperationStepState.COMPLETED
        : index === active
          ? state
          : OperationStepState.PENDING,
  }));
}

function issuanceProfileSteps(
  operation: Operation,
  type: OperationStepType,
): OperationStep[] {
  const states = {
    pending: OperationStepState.PENDING,
    processing: OperationStepState.PROCESSING,
    completed: OperationStepState.COMPLETED,
    failed: OperationStepState.FAILED,
  };
  return [{ type, state: states[operation.state] }];
}

function credentialDefinitionRegistrationSteps(
  operation: Operation,
): OperationStep[] {
  const result = object(operation.result);
  const registration = object(result.registration);
  const stage =
    typeof registration.stage === 'string' ? registration.stage : '';
  const options = object(operation.request?.body?.options);
  const status = object(options.status);
  const revocation = object(status.revocation);
  const revocationEnabled = revocation.enabled !== false;
  const types =
    options.format !== 'anoncreds'
      ? [OperationStepType.CREDENTIAL_DEFINITION_REGISTER]
      : [
          OperationStepType.SCHEMA_REGISTER,
          OperationStepType.CREDENTIAL_DEFINITION_REGISTER,
          OperationStepType.REVOCATION_SETUP,
        ];
  let active = stage.includes('revocation')
    ? 2
    : stage.includes('definition')
      ? 1
      : 0;
  if (types.length === 1) active = 0;
  if (operation.state === OperationState.COMPLETED) active = types.length;
  const steps = sequence(
    types,
    active,
    operation.state === OperationState.FAILED
      ? OperationStepState.FAILED
      : operation.state === OperationState.PENDING
        ? OperationStepState.PENDING
        : stage.startsWith('awaiting_')
          ? OperationStepState.WAITING
          : OperationStepState.PROCESSING,
  );
  if (!revocationEnabled && steps.length === 3)
    steps[2].state = OperationStepState.SKIPPED;
  return steps;
}

function credentialOfferSteps(operation: Operation): OperationStep[] {
  const exchangeState = operation.exchange?.state;
  const types = [
    OperationStepType.OFFER_SEND,
    OperationStepType.HOLDER_REQUEST,
    OperationStepType.CREDENTIAL_ISSUE,
  ];
  if (
    operation.state === OperationState.COMPLETED ||
    exchangeState === CredentialExchangeState.CredentialIssued ||
    exchangeState === CredentialExchangeState.Done
  )
    return sequence(types, types.length, OperationStepState.COMPLETED);
  if (
    exchangeState === CredentialExchangeState.Abandoned ||
    exchangeState === 'failed'
  ) {
    // The terminal exchange state alone does not identify which step failed.
    return sequence(types, 0, OperationStepState.PENDING);
  }
  const active =
    exchangeState === CredentialExchangeState.RequestReceived ||
    exchangeState === CredentialExchangeState.RequestSent
      ? 2
      : exchangeState === CredentialExchangeState.OfferSent
        ? 1
        : 0;
  return sequence(
    types,
    active,
    operation.state === OperationState.FAILED
      ? OperationStepState.FAILED
      : operation.state === OperationState.PENDING
        ? OperationStepState.PENDING
        : active === 2 && operation.exchange?.issueSubmission === 'submitting'
          ? OperationStepState.PROCESSING
          : active > 0
            ? OperationStepState.WAITING
            : OperationStepState.PROCESSING,
  );
}

/** Project existing durable registration/exchange progress, not a second workflow. */
export function operationSteps(operation: Operation): OperationStep[] {
  const profileType = PROFILE_STEPS.get(operation.type);
  if (profileType) return issuanceProfileSteps(operation, profileType);
  if (operation.type === OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER)
    return credentialDefinitionRegistrationSteps(operation);
  if (operation.type === OPERATION_TYPE.CREDENTIAL_OFFER)
    return credentialOfferSteps(operation);
  return [];
}
