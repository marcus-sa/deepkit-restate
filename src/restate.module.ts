import { AppModule, ControllerConfig, createModule } from '@deepkit/app';
import { provide } from '@deepkit/injector';

import { Routers } from './routers';
import { RestateServer } from './restate-server';
import { restateClassDecorator } from './decorator';
import { RestateContext, RestateKeyedContext } from './types';

export class RestateConfig {
  readonly port: number = 9080;
}

export class RestateModule extends createModule({
  config: RestateConfig,
  listeners: [RestateServer],
}) {
  readonly routers = new Routers();

  override process() {
    this.addProvider({
      provide: Routers,
      useValue: this.routers,
    });
    // this.addProvider(
    //   provide<RestateKeyedContext>({
    //     scope: 'restate',
    //     useFactory() {
    //       throw new Error('Unimplemented');
    //     },
    //   }),
    // );
    // this.addProvider(
    //   provide<RestateContext>({
    //     scope: 'restate',
    //     useFactory() {
    //       throw new Error('Unimplemented');
    //     },
    //   }),
    // );
  }

  override processController(
    module: AppModule<any>,
    { controller }: ControllerConfig,
  ) {
    if (!controller) return;

    const resolver = restateClassDecorator._fetch(controller);
    if (!resolver) return;

    if (!module.isProvided(controller)) {
      module.addProvider({ provide: controller, scope: 'restate' });
    }

    this.routers.add({ controller, module });
  }
}
