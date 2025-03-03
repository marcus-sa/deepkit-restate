import { AppModule, ControllerConfig, createModuleClass } from '@deepkit/app';
import {provide} from "@deepkit/injector";
import { ClassType } from '@deepkit/core';

import { RestateAdminClient } from './restate-admin-client.js';
import {RestateClient, RestateHttpClient, RestateMemoryClient} from './restate-client.js';
import { RestateConfig } from './config.js';
import { RestateServer } from './restate-server.js';
import { RestateEventModule } from './event/module.js';
import {
  RestateMemoryContextStorage,
  RestateContextStorage,
} from './restate-context-storage.js';
import {
  RestateObjectMetadata,
  RestateSagaMetadata,
  RestateServiceMetadata,
} from './decorator.js';
import {
  restateObjectContextType,
  restateSagaContextType,
  restateServiceContextType,
  SCOPE,
} from './types.js';
import { createClassProxy, getRestateClassDeps } from './utils.js';
import {
  getRestateObjectMetadata,
  getRestateSagaMetadata,
  getRestateServiceMetadata,
} from './metadata.js';
import {ModuleSagas, ModuleObjects, ModuleServices} from "./providers.js";

export class RestateModule extends createModuleClass({
  config: RestateConfig,
  forRoot: true,
}) {
  readonly services = new ModuleServices();
  readonly objects = new ModuleObjects();
  readonly sagas = new ModuleSagas();

  override process() {
    if (this.config.ingress) {
      this.addProvider(RestateHttpClient);
      this.addProvider(provide<RestateClient>({
        useExisting: RestateHttpClient,
      }));
    } else {
      this.addProvider(RestateMemoryClient);
      this.addProvider(provide<RestateClient>({
        useExisting: RestateMemoryClient,
      }));
    }

    if (this.config.event) {
      this.addImport(new RestateEventModule(this.config.event));
    }

    if (this.config.admin) {
      this.addProvider(RestateAdminClient);
    }

    if (this.config.server) {
      this.addListener(RestateServer);
      this.addProvider(RestateContextStorage);
    } else {
      this.addProvider(RestateMemoryContextStorage);
      this.addProvider({
        provide: RestateContextStorage,
        useExisting: RestateMemoryContextStorage,
      });
      this.addProvider({
        provide: restateServiceContextType,
        scope: SCOPE,
        useFactory(contextStorage: RestateMemoryContextStorage) {
          return contextStorage.getStore();
        },
      });
      this.addProvider({
        provide: restateObjectContextType,
        scope: SCOPE,
        useFactory(contextStorage: RestateMemoryContextStorage) {
          return contextStorage.getStore();
        },
      });
      this.addProvider({
        provide: restateSagaContextType,
        scope: SCOPE,
        useFactory(contextStorage: RestateMemoryContextStorage) {
          return contextStorage.getStore();
        },
      });
    }

    this.addProvider({
      provide: restateServiceContextType,
      scope: SCOPE,
      useFactory() {
        throw new Error('You cannot use a service context in an object');
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

  private addService(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateServiceMetadata,
  ): void {
    this.services.add({ classType, module, metadata });
  }

  private addObject(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateObjectMetadata,
  ): void {
    this.objects.add({ classType, module, metadata });
  }

  private addSaga(
    module: AppModule<any>,
    classType: ClassType,
    metadata: RestateSagaMetadata,
  ): void {
    this.sagas.add({ classType, module, metadata });
  }

  private addDeps(classType: ClassType): void {
    const restateServiceDeps = getRestateClassDeps(classType);

    for (const dependency of restateServiceDeps) {
      if (!this.isProvided(dependency)) {
        this.addProvider({
          provide: dependency,
          scope: SCOPE,
          useValue: createClassProxy(dependency),
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

    // if (!this.config.server) {
    //   throw new Error('Restate server config is missing');
    // }

    this.addDeps(controller);

    if (!module.isProvided(controller)) {
      module.addProvider({ provide: controller, scope: SCOPE });
    }
  }
}
