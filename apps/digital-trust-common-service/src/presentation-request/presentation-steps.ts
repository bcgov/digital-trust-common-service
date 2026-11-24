import {
  OperationState,
  OperationStep,
  OperationStepState,
} from '../operation/operation.entity';

export function presentationSteps(
  stage: number,
  state: OperationState,
): OperationStep[] {
  const types = ['send', 'await-presentation', 'verify'];
  const activeStage =
    state === OperationState.FAILED ? Math.min(stage, 2) : stage;
  return types.map((type, index) => ({
    type,
    state:
      state === OperationState.COMPLETED || index < activeStage
        ? OperationStepState.COMPLETED
        : index === Math.min(activeStage, 2)
          ? state === OperationState.FAILED
            ? OperationStepState.FAILED
            : state === OperationState.PENDING
              ? OperationStepState.PENDING
              : index === 1
                ? OperationStepState.WAITING
                : OperationStepState.PROCESSING
          : OperationStepState.PENDING,
  }));
}
