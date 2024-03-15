import { SagaExecutionState } from './saga-execution-state.js';
import { SagaStepOutcome } from './step-outcome.js';

export class SagaActions<Data> {
  static makeEndState<Data>(state: SagaExecutionState): SagaActions<Data> {
    return new SagaActions<Data>(
      state.compensating,
      true,
      SagaExecutionState.makeEndState(),
    );
  }

  static makeStepExecution<Data>(
    data: Data,
    newState: SagaExecutionState,
    oldState: SagaExecutionState,
    stepOutcome?: SagaStepOutcome,
  ) {
    return new SagaActions<Data>(
      oldState.compensating,
      newState.endState,
      newState,
      data,
      stepOutcome,
    );
  }

  constructor(
    public compensating: boolean = false,
    public endState: boolean = false,
    public updatedState?: SagaExecutionState,
    public updatedData?: Data,
    public stepOutcome?: SagaStepOutcome,
  ) {}
}
