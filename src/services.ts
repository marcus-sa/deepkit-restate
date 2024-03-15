import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

import { RestateServiceMetadata } from './decorator.js';

export interface Service<T> {
  readonly classType: ClassType<T>;
  readonly module?: InjectorModule;
  readonly metadata: RestateServiceMetadata;
}

export class Services extends Set<Service<unknown>> {}
