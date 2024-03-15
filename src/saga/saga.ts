import { StepBuilder } from './step-builder.js';
import { SagaDefinitionBuilder } from './saga-definition-builder.js';
import { SagaDefinition } from './saga-definition.js';
import { AsyncLike } from './types.js';

export abstract class Saga<Data> {
  abstract readonly definition: SagaDefinition<Data>;

  protected step(): StepBuilder<Data> {
    return new StepBuilder<Data>(new SagaDefinitionBuilder<Data>(this));
  }

  onSagaCompletedSuccessfully(id: string, data: Data): AsyncLike<void> {}

  onStarting(id: string, data: Data): AsyncLike<void> {}

  onSagaRolledBack(id: string, data: Data): AsyncLike<void> {}
}
