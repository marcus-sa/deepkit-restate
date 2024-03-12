import { cast } from '@deepkit/type';

import { SagaStep } from './saga-step';
import { SagaExecutionState } from './saga-execution-state';
import { SagaActions } from './saga-actions';

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
    // const builder = new SagaActionsBuilder<Data>();
    // const withIsLocal = builder.withIsLocal.bind(builder);
    // const withCommands = builder.withCommands.bind(builder);

    const rpc = await this.step?.createStepOutcome(data, this.compensating);

    return cast<SagaActions<Data>>({
      updatedData: data,
      updatedState: newState,
      endState: newState.endState,
      compensating: currentState.compensating,
      rpc,
    });
  }
}
