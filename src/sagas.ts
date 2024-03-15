import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

import { RestateSagaMetadata } from './decorator.js';

import { Saga as _Saga } from './saga/saga.js';

export interface Saga {
  readonly classType: ClassType<_Saga<unknown>>;
  readonly module?: InjectorModule;
  readonly metadata: RestateSagaMetadata;
}

export class Sagas extends Set<Saga> {}
