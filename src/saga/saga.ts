import { StepBuilder } from './step-builder.js';
import { SagaDefinitionBuilder } from './saga-definition-builder.js';
import { SagaDefinition } from './saga-definition.js';
import { AsyncLike } from './types.js';

// interface SagaAwakeable {
//   readonly idOrTypeName: string;
//   readonly awakeable: RestateAwakeable<unknown>;
// }

export abstract class Saga<Data> {
  abstract readonly definition: SagaDefinition<Data>;

  // readonly _awakeables = new Set<SagaAwakeable>();

  protected step(): StepBuilder<Data> {
    return new StepBuilder<Data>(new SagaDefinitionBuilder<Data>(this));
  }

  // resolveAwakeable<T extends string | boolean | number | symbol>(id: string, type?: ReceiveType<T>): Promise<void>;
  // resolveAwakeable<T>(id?: string, type?: ReceiveType<T>): Promise<void>;
  // async resolveAwakeable<T>(id?: string, type?: ReceiveType<T>): Promise<void> {
  //   type = resolveReceiveType(type);
  // }
  //
  // getAwakeable<T extends string | boolean | number | symbol>(id: string, type?: ReceiveType<T>): RestateAwakeable<T>;
  // getAwakeable<T>(id?: string, type?: ReceiveType<T>): RestateAwakeable<T>;
  // getAwakeable<T>(id?: string, type?: ReceiveType<T>): RestateAwakeable<T> {
  //   type = resolveReceiveType(type);
  // }
  //
  // waitForAwakeable<T extends string | boolean | number | symbol>(id: string, type?: ReceiveType<T>): Promise<T>;
  // waitForAwakeable<T>(id?: string, type?: ReceiveType<T>): Promise<T>;
  // async waitForAwakeable<T>(id?: string, type?: ReceiveType<T>): Promise<T> {
  //   type = resolveReceiveType(type);
  // }
  //
  // rejectAwakeable<T extends string | boolean | number | symbol>(id: string, type?: ReceiveType<T>): Promise<void>;
  // rejectAwakeable<T>(id?: string, type?: ReceiveType<T>): Promise<void>;
  // async rejectAwakeable<T>(id?: string, type?: ReceiveType<T>): Promise<void> {
  //   type = resolveReceiveType(type);
  // }

  onSagaCompletedSuccessfully(id: string, data: Data): AsyncLike<void> {}

  onStarting(id: string, data: Data): AsyncLike<void> {}

  onSagaRolledBack(id: string, data: Data): AsyncLike<void> {}
}
