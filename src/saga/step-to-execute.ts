import { cast } from '@deepkit/type';

import { SagaStep } from './saga-step';
import { SagaExecutionState } from './saga-execution-state';
import { SagaActions } from './saga-actions';
import { RestateSagaContext } from '../types';

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
    ctx: RestateSagaContext,
    data: Data,
    currentState: SagaExecutionState,
  ): Promise<SagaActions<Data>> {
    const newState = currentState.nextState(this.size());

    const stepOutcome = await this.step?.createStepOutcome(
      ctx,
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
