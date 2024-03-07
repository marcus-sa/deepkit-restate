import { AppModule, ControllerConfig, createModule } from '@deepkit/app';

import { Services } from './services';
import { RestateServer } from './restate-server';
import { restateClassDecorator } from './decorator';
import { restateContextType, restateKeyedContextType, SCOPE } from './types';
import { createServiceProxy, getRestateServiceDeps } from './utils';

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
  }

  override processController(
    module: AppModule<any>,
    { controller }: ControllerConfig,
  ) {
    if (!controller) return;

    const metadata = restateClassDecorator._fetch(controller);
    if (!metadata) return;

    const restateServiceDeps = getRestateServiceDeps(metadata.classType);

    for (const dependency of restateServiceDeps) {
      if (!this.isProvided(dependency)) {
        this.addProvider({
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
