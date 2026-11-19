import {
  mergePresentationSteps,
  OperationStepType as Type,
  presentationSteps,
} from './operation-steps';
import {
  OperationState,
  OperationStepState as State,
} from './operation.entity';

describe('presentation operation steps', () => {
  it.each([
    [
      0,
      OperationState.PROCESSING,
      [State.PROCESSING, State.PENDING, State.PENDING],
    ],
    [
      1,
      OperationState.PROCESSING,
      [State.COMPLETED, State.WAITING, State.PENDING],
    ],
    [
      2,
      OperationState.PROCESSING,
      [State.COMPLETED, State.COMPLETED, State.PROCESSING],
    ],
    [0, OperationState.FAILED, [State.FAILED, State.PENDING, State.PENDING]],
    [1, OperationState.FAILED, [State.COMPLETED, State.FAILED, State.PENDING]],
    [
      2,
      OperationState.FAILED,
      [State.COMPLETED, State.COMPLETED, State.FAILED],
    ],
    [
      3,
      OperationState.COMPLETED,
      [State.COMPLETED, State.COMPLETED, State.COMPLETED],
    ],
  ] as const)(
    'builds stage %s for %s operation',
    (stage, state, expectedStates) => {
      const steps = presentationSteps(stage, state);
      expect(steps.map((step) => step.type)).toEqual([
        Type.PRESENTATION_REQUEST_SEND,
        Type.PRESENTATION_RECEIVE,
        Type.PRESENTATION_VERIFY,
      ]);
      expect(steps.map((step) => step.state)).toEqual(expectedStates);
    },
  );

  it('does not regress a later persisted stage on a duplicate or out-of-order event', () => {
    const later = presentationSteps(2, OperationState.PROCESSING);
    expect(
      mergePresentationSteps(
        later,
        presentationSteps(1, OperationState.PROCESSING),
      ),
    ).toEqual(later);
  });

  it('preserves terminal step evidence when later progress is offered', () => {
    const failed = presentationSteps(2, OperationState.FAILED);
    expect(
      mergePresentationSteps(
        failed,
        presentationSteps(3, OperationState.COMPLETED),
      ),
    ).toEqual(failed);
  });
});
