import { SagaStep } from './saga-step';

export class SagaDefinition<Data> {
  constructor(readonly steps: Set<SagaStep<Data>>) {}
}
