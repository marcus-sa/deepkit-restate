import { SagaStep } from './saga-step.js';
import { SagaExecutionState } from './saga-execution-state.js';
import { SagaActions } from './saga-actions.js';
import { RestateSagaContext } from '../types.js';

export class StepToExecute<Data> {
  constructor(
    private readonly skipped: number,
    private readonly compensating: boolean,
    private readonly step?: SagaStep<Data>,
  ) {}

  private size(): number {
    return (!this.isEmpty() ? 1 : 0) + this.skipped;
  }

  isEmpty(): boolean {
    return !this.step;
  }

  async executeStep(
    data: Data,
    currentState: SagaExecutionState,
  ): Promise<SagaActions<Data>> {
    const newState = currentState.nextState(this.size());

    const stepOutcome = await this.step?.createStepOutcome(
      data,
      this.compensating,
    );

    return SagaActions.makeStepExecution(
      data,
      newState,
      currentState,
      stepOutcome,
    );
  }
}
