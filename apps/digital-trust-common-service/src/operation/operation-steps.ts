import {
  OperationState,
  OperationStep,
  OperationStepState,
} from './operation.entity';

export enum OperationStepType {
  PRESENTATION_DEFINITION_CREATE = 'presentation-definition.create',
  PRESENTATION_DEFINITION_UPDATE = 'presentation-definition.update',
  PRESENTATION_DEFINITION_PUBLISH = 'presentation-definition.publish',
  PRESENTATION_DEFINITION_DEPRECATE = 'presentation-definition.deprecate',
  PRESENTATION_REQUEST_SEND = 'presentation-request.send',
  PRESENTATION_RECEIVE = 'presentation.receive',
  PRESENTATION_VERIFY = 'presentation.verify',
}

const PRESENTATION_REQUEST_STEP_TYPES = [
  OperationStepType.PRESENTATION_REQUEST_SEND,
  OperationStepType.PRESENTATION_RECEIVE,
  OperationStepType.PRESENTATION_VERIFY,
];

export function presentationSteps(
  stage: number,
  operationState: OperationState,
): OperationStep[] {
  if (operationState === OperationState.COMPLETED) {
    return PRESENTATION_REQUEST_STEP_TYPES.map((type) => ({
      type,
      state: OperationStepState.COMPLETED,
    }));
  }

  const activeStage =
    operationState === OperationState.FAILED ? Math.min(stage, 2) : stage;
  return PRESENTATION_REQUEST_STEP_TYPES.map((type, index) => ({
    type,
    state:
      index < activeStage
        ? OperationStepState.COMPLETED
        : index === activeStage
          ? operationState === OperationState.FAILED
            ? OperationStepState.FAILED
            : operationState === OperationState.PENDING
              ? OperationStepState.PENDING
              : activeStage === 1
                ? OperationStepState.WAITING
                : OperationStepState.PROCESSING
          : OperationStepState.PENDING,
  }));
}

export function mergePresentationSteps(
  current: readonly OperationStep[],
  next: readonly OperationStep[],
): OperationStep[] {
  if (
    current.length !== next.length ||
    current.some((step, index) => step.type !== next[index].type)
  ) {
    return [...next];
  }

  const rank: Record<OperationStepState, number> = {
    [OperationStepState.PENDING]: 0,
    [OperationStepState.PROCESSING]: 1,
    [OperationStepState.WAITING]: 2,
    [OperationStepState.COMPLETED]: 3,
    [OperationStepState.FAILED]: 3,
    [OperationStepState.SKIPPED]: 3,
  };
  return next.map((step, index) =>
    rank[step.state] > rank[current[index].state] ? step : current[index],
  );
}
