import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

import { RestateSagaMetadata } from './decorator';

import { Saga as _Saga } from './saga/saga';

export interface Saga {
  readonly classType: ClassType<_Saga>;
  readonly module?: InjectorModule;
  readonly metadata: RestateSagaMetadata;
}

export class Sagas extends Set<Saga> {}
