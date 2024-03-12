import { SagaStep } from './saga-step';
import { SagaExecutionState } from './saga-execution-state';
import { StepToExecute } from './step-to-execute';
import { SagaInstance } from './saga-instance';
import { SagaActions } from './saga-actions';

export class SagaDefinition<Data> {
  constructor(readonly steps: readonly SagaStep<Data>[]) {}

  private async nextStepToExecute(
    { compensating, currentlyExecuting }: SagaExecutionState,
    data: Data,
  ): Promise<StepToExecute<Data>> {
    const direction = compensating ? -1 : +1;
    let skipped = 0;

    for (
      let i = currentlyExecuting + direction;
      i >= 0 && i < this.steps.length;
      i = i + direction
    ) {
      const step = this.steps[i];
      if (
        compensating
          ? step.hasCompensation(data)
          : step.hasAction(data)
      ) {
        return new StepToExecute<Data>(skipped, compensating, step);
      } else {
        skipped++;
      }
    }

    return new StepToExecute<Data>(skipped, compensating);
  }

  private async executeNextStep(
    sagaData: Data,
    currentState: SagaExecutionState,
  ): Promise<SagaActions<Data>> {
    const stepToExecute = await this.nextStepToExecute(currentState, sagaData);

    return stepToExecute.isEmpty()
      ? SagaActions.makeEndState(currentState)
      : stepToExecute.executeStep(sagaData, currentState);
  }

  async start(instance: SagaInstance<Data>): Promise<SagaActions<Data>> {
    return this.executeNextStep(instance.data, instance.currentState);
  }

  async handleReply(
    actions: SagaActions<Data>,
    failure: boolean,
  ): Promise<SagaActions<Data>> {}
}
