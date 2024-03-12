import { StepBuilder } from './step-builder';
import { SagaDefinitionBuilder } from './saga-definition-builder';
import { SagaDefinition } from './saga-definition';
import { RestateSagaContext } from '../types';

export abstract class Saga<Data> {
  abstract readonly definition: SagaDefinition<Data>;

  constructor(protected readonly ctx: RestateSagaContext) {}

  protected step(): StepBuilder<Data> {
    return new StepBuilder<Data>(new SagaDefinitionBuilder<Data>(this));
  }
}
