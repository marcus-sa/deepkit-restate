import { StepBuilder } from './step-builder';
import { SagaDefinitionBuilder } from './saga-definition-builder';
import { SagaDefinition } from './saga-definition';
import { AsyncLike } from './types';

export abstract class Saga<Data> {
  abstract readonly definition: SagaDefinition<Data>;

  protected step(): StepBuilder<Data> {
    return new StepBuilder<Data>(new SagaDefinitionBuilder<Data>(this));
  }

  onSagaCompletedSuccessfully(data: Data): AsyncLike<void> {}

  onStarting(id: string, data: Data): AsyncLike<void> {}

  onSagaRolledBack(data: Data): AsyncLike<void> {}
}
