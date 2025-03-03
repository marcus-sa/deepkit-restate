import { StepBuilder } from './step-builder.js';
import { SagaDefinitionBuilder } from './saga-definition-builder.js';
import { SagaDefinition } from './saga-definition.js';
import { AsyncLike } from './types.js';

export abstract class Saga<Data> {
  abstract readonly definition: SagaDefinition<Data>;

  protected step(): StepBuilder<Data> {
    return new StepBuilder<Data>(new SagaDefinitionBuilder<Data>(this));
  }

  onSagaCompletedSuccessfully(data: Data): AsyncLike<void> {}

  onStarting(data: Data): AsyncLike<void> {}

  onSagaRolledBack(data: Data): AsyncLike<void> {}
}
