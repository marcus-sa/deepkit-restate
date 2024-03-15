import { AppModule, ControllerConfig, createModule } from '@deepkit/app';
import { ClassType } from '@deepkit/core';

import { Services } from './services.js';
import { RestateServer } from './restate-server.js';
import {
  restateContextType,
  restateKeyedContextType,
  restateSagaContextType,
  SCOPE,
} from './types.js';
import { Sagas } from './sagas.js';
import {
  createServiceProxy,
  getRestateSagaMetadata,
  getRestateServiceDeps,
  getRestateServiceMetadata,
} from './utils.js';
import { RestateSagaMetadata, RestateServiceMetadata } from './decorator.js';

export class RestateConfig {
  readonly port: number = 9080;
}

export class RestateModule extends createModule({
  config: RestateConfig,
  listeners: [RestateServer],
  forRoot: true,
}) {
  readonly services = new Services();
  readonly sagas = new Sagas();

  override process() {
    this.addProvider({
      provide: Services,
      useValue: this.services,
    });

    this.addProvider({
      provide: Sagas,
      useValue: this.sagas,
    });

    this.addProvider({
      provide: restateContextType,
      scope: SCOPE,
      useFactory() {
        throw new Error('You cannot use an unkeyed context in a keyed service');
      },
    });

    this.addProvider({
      provide: restateKeyedContextType,
      scope: SCOPE,
      useFactory() {
        throw new Error('You cannot use a keyed context in an unkeyed service');
      },
    });

    this.addProvider({
      provide: restateSagaContextType,
      scope: SCOPE,
      useFactory() {
        throw new Error('You cannot use a saga context outside a saga');
      },
    });
  }

  private addService(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateServiceMetadata,
  ): void {
    this.services.add({ classType, module, metadata });
  }

  private addSaga(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateSagaMetadata,
  ): void {
    this.sagas.add({ classType, module, metadata });
  }

  private addDeps(classType: ClassType): void {
    const restateServiceDeps = getRestateServiceDeps(classType);

    for (const dependency of restateServiceDeps) {
      if (!this.isProvided(dependency)) {
        this.addProvider({
          provide: dependency,
          scope: SCOPE,
          useValue: createServiceProxy(dependency),
        });
      }
    }
  }

  override processController(
    module: AppModule<any>,
    { controller }: ControllerConfig,
  ) {
    if (!controller) return;

    const serviceMetadata = getRestateServiceMetadata(controller);
    const sagaMetadata = getRestateSagaMetadata(controller);
    if (serviceMetadata) {
      this.addService(module, controller, serviceMetadata);
    } else if (sagaMetadata) {
      this.addSaga(module, controller, sagaMetadata);
    } else {
      return;
    }

    this.addDeps(controller);

    if (!module.isProvided(controller)) {
      module.addProvider({ provide: controller, scope: SCOPE });
    }
  }
}
