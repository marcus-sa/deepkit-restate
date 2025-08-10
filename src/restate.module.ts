import { AppModule, ControllerConfig, createModuleClass } from '@deepkit/app';
import { ClassType } from '@deepkit/core';

import { RestateAdminClient } from './restate-admin-client.js';
import { RestateIngressClient } from './restate-ingress-client.js';
import { RestateConfig } from './config.js';
import { InjectorServices } from './services.js';
import { InjectorObjects } from './objects.js';
import { InjectorSagas } from './sagas.js';
import { RestateServer } from './restate-server.js';
import { RestateEventModule } from './event/module.js';
import {
  RestateClassMetadata,
  RestateObjectMetadata,
  RestateSagaMetadata,
  RestateServiceMetadata,
} from './decorator.js';
import {
  restateObjectContextType,
  restateSagaContextType,
  restateServiceContextType,
  SCOPE,
  restateClientType,
  restateSharedContextType,
} from './types.js';
import { makeInterfaceProxy, getRestateClassDeps } from './utils.js';
import {
  getRestateObjectMetadata,
  getRestateSagaMetadata,
  getRestateServiceMetadata,
} from './metadata.js';
import { RestateMiddleware } from './middleware.js';

export class RestateModule extends createModuleClass({
  config: RestateConfig,
  forRoot: true,
}) {
  readonly services = new InjectorServices();
  readonly objects = new InjectorObjects();
  readonly sagas = new InjectorSagas();
  readonly defaultMiddlewares: ClassType<RestateMiddleware>[] = [];

  override process() {
    if (this.config.ingress) {
      this.addProvider(RestateIngressClient);
    } else {
      this.addProvider({
        provide: RestateIngressClient,
        useFactory() {
          throw new Error('Restate ingress config is missing');
        },
      });
    }
    this.addProvider({
      provide: restateClientType,
      useExisting: RestateIngressClient,
    });

    if (this.config.pubsub) {
      this.addImport(new RestateEventModule(this.config.pubsub));
    }

    if (this.config.admin) {
      this.addProvider(RestateAdminClient);
    }

    if (this.config.server) {
      this.addListener(RestateServer);

      this.addProvider({
        provide: InjectorServices,
        useValue: this.services,
      });

      this.addProvider({
        provide: InjectorObjects,
        useValue: this.objects,
      });

      this.addProvider({
        provide: InjectorSagas,
        useValue: this.sagas,
      });

      // this.addProvider({
      //   provide: restateClientType,
      //   scope: SCOPE,
      //   useFactory() {
      //     throw new Error('Client has not been provided yet');
      //   },
      // })

      this.addProvider({
        provide: restateSharedContextType,
        scope: SCOPE,
        useFactory() {
          throw new Error('You cannot use a context outside a service');
        },
      });

      this.addProvider({
        provide: restateServiceContextType,
        scope: SCOPE,
        useFactory() {
          throw new Error('You cannot use a context outside a service');
        },
      });

      this.addProvider({
        provide: restateObjectContextType,
        scope: SCOPE,
        useFactory() {
          throw new Error('You cannot use an object context in a service');
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
  }

  private provideMiddleware(metadata: RestateClassMetadata): void {
    for (const middleware of metadata.middlewares) {
      if (!this.isProvided(middleware))
        this.addProvider({ provide: middleware, scope: SCOPE });
    }
    for (const handler of metadata.handlers) {
      for (const middleware of handler.middlewares) {
        if (!this.isProvided(middleware))
          this.addProvider({ provide: middleware, scope: SCOPE });
      }
    }
  }

  private addService(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateServiceMetadata,
  ): void {
    this.services.add({ classType, module, metadata });
    this.provideMiddleware(metadata);
  }

  private addObject(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateObjectMetadata,
  ): void {
    this.objects.add({ classType, module, metadata });
    this.provideMiddleware(metadata);
  }

  private addSaga(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateSagaMetadata,
  ): void {
    this.sagas.add({ classType, module, metadata });
    this.provideMiddleware(metadata);
  }

  private addDeps(classType: ClassType): void {
    const restateServiceDeps = getRestateClassDeps(classType);

    for (const dependency of restateServiceDeps) {
      if (!this.isProvided(dependency)) {
        this.addProvider({
          provide: dependency,
          scope: SCOPE,
          useValue: makeInterfaceProxy(dependency),
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
    if (serviceMetadata) {
      this.addService(module, controller, serviceMetadata);
    } else {
      const objectMetadata = getRestateObjectMetadata(controller);
      if (objectMetadata) {
        this.addObject(module, controller, objectMetadata);
      } else {
        const sagaMetadata = getRestateSagaMetadata(controller);
        if (sagaMetadata) {
          this.addSaga(module, controller, sagaMetadata);
        } else {
          return;
        }
      }
    }

    if (!this.config.server) {
      throw new Error('Restate server config is missing');
    }

    this.addDeps(controller);

    if (!module.isProvided(controller)) {
      module.addProvider({ provide: controller, scope: SCOPE });
    }
  }

  addDefaultMiddleware(...middlewares: ClassType<RestateMiddleware>[]): this {
    this.defaultMiddlewares.push(...middlewares);
    this.addProvider(
      ...middlewares.map(middleware => ({ provide: middleware, scope: SCOPE })),
    );
    return this;
  }
}
