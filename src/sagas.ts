import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

import { RestateSagaMetadata } from './decorator.js';

import { Saga } from './saga/saga.js';

export interface InjectorSaga {
  readonly classType: ClassType<Saga<unknown>>;
  readonly module?: InjectorModule;
  readonly metadata: RestateSagaMetadata;
}

export class InjectorSagas extends Set<InjectorSaga> {}
