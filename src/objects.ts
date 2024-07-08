import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

import { RestateObjectMetadata } from './decorator.js';

export interface InjectorObject<T> {
  readonly classType: ClassType<T>;
  readonly module?: InjectorModule;
  readonly metadata: RestateObjectMetadata;
}

export class InjectorObjects extends Set<InjectorObject<unknown>> {}
