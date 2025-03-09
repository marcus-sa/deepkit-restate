import { ClassType } from '@deepkit/core';
import { InjectorModule } from '@deepkit/injector';

import {
  RestateObjectMetadata,
  RestateSagaMetadata,
  RestateServiceMetadata,
} from './decorator.js';
import { Saga } from './saga/saga.js';

export interface ModuleService<T> {
  readonly classType: ClassType<T>;
  readonly module?: InjectorModule;
  readonly metadata: RestateServiceMetadata;
}

export class ModuleServices extends Set<ModuleService<unknown>> {}

export interface ModuleObject<T> {
  readonly classType: ClassType<T>;
  readonly module?: InjectorModule;
  readonly metadata: RestateObjectMetadata;
}

export class ModuleObjects extends Set<ModuleObject<unknown>> {}

export interface ModuleSaga {
  readonly classType: ClassType<Saga<unknown>>;
  readonly module?: InjectorModule;
  readonly metadata: RestateSagaMetadata;
}

export class ModuleSagas extends Set<ModuleSaga> {}
