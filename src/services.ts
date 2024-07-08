import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

import { RestateServiceMetadata } from './decorator.js';

export interface InjectorService<T> {
  readonly classType: ClassType<T>;
  readonly module?: InjectorModule;
  readonly metadata: RestateServiceMetadata;
}

export class InjectorServices extends Set<InjectorService<unknown>> {}
