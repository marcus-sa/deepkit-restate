import { AppModule, ControllerConfig, createModule } from '@deepkit/app';

import { Services } from './services';
import { RestateServer } from './restate-server';
import { restateClassDecorator } from './decorator';
import {
  restateContextType,
  RestateKeyedContextImpl,
  restateKeyedContextType,
  SCOPE,
} from './types';
import {
  createServiceProxy,
  getRestateServiceDeps,
  getRestateServiceMetadata,
} from './utils';

export class RestateConfig {
  readonly port: number = 9080;
}

export class RestateModule extends createModule({
  config: RestateConfig,
  listeners: [RestateServer],
  forRoot: true,
}) {
  readonly services = new Services();

  override process() {
    this.addProvider({
      provide: Services,
      useValue: this.services,
    });
  }

  override processController(
    module: AppModule<any>,
    { controller }: ControllerConfig,
  ) {
    if (!controller) return;

    const resolver = restateClassDecorator._fetch(controller);
    if (!resolver) return;

    module.addProvider({
      provide: restateKeyedContextType,
      scope: SCOPE,
      useFactory() {
        throw new Error('You cannot use a keyed context in a unkeyed service');
      },
    });

    module.addProvider({
      provide: restateContextType,
      scope: SCOPE,
      useFactory() {
        throw new Error('You cannot use a unkeyed context in a keyed service');
      },
    });

    const metadata = getRestateServiceMetadata(controller);
    const restateServiceDeps = getRestateServiceDeps(metadata.classType);

    for (const dependency of restateServiceDeps) {
      if (!module.isProvided(dependency)) {
        module.addProvider({
          provide: dependency,
          scope: SCOPE,
          useValue: createServiceProxy(dependency),
        });
      }
    }

    if (!module.isProvided(controller)) {
      module.addProvider({ provide: controller, scope: SCOPE });
    }

    this.services.add({ controller, module, metadata });
  }
}
