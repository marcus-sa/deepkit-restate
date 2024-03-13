import { SagaStep } from './saga-step';
import { Saga } from './saga';
import { SagaDefinition } from './saga-definition';

export class SagaDefinitionBuilder<Data> {
  private readonly steps: SagaStep<Data>[] = [];

  constructor(readonly saga: Saga<Data>) {}

  addStep(step: SagaStep<Data>): void {
    this.steps.push(step);
  }

  build(): SagaDefinition<Data> {
    return new SagaDefinition<Data>(this.steps);
  }
}
