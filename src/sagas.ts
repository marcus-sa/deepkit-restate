import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

import { RestateSagaMetadata } from './decorator';

export interface Saga<T> {
  readonly classType: ClassType<T>;
  readonly module?: InjectorModule;
  readonly metadata: RestateSagaMetadata;
}

export class Sagas extends Set<Saga<unknown>> {}
