import { StepBuilder } from './step-builder';
import { SagaDefinitionBuilder } from './saga-definition-builder';
import { SagaDefinition } from './saga-definition';
import { RestateSagaContext } from '../types';
import { AsyncLike } from './types';

export abstract class Saga<Data> implements SagaLifecycleHooks<Data> {
  abstract readonly definition: SagaDefinition<Data>;

  constructor(protected readonly ctx: RestateSagaContext) {}

  protected step(): StepBuilder<Data> {
    return new StepBuilder<Data>(new SagaDefinitionBuilder<Data>(this));
  }
}

export type SagaLifecycleHooks<Data> = Partial<
  OnSagaRolledBack<Data> & OnSagaCompletedSuccessfully<Data> & OnStarting<Data>
>;

export interface OnSagaCompletedSuccessfully<Data> {
  onSagaCompletedSuccessfully(data: Data): AsyncLike<void>;
}

export interface OnStarting<Data> {
  onStarting(data: Data): AsyncLike<void>;
}

export interface OnSagaRolledBack<Data> {
  onSagaRolledBack(data: Data): AsyncLike<void>;
}
