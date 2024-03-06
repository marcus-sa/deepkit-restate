import { InjectorModule } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';

export interface Router<T> {
  readonly controller: ClassType<T>;
  readonly module?: InjectorModule;
}

export class Routers extends Set<Router<unknown>> {}
