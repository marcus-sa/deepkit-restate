import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { RestateModule } from '../src/restate.module.js';
import { RestateEventsServerModule } from '../src/event/server/module.js';

await new App({
  imports: [
    new FrameworkModule({
      port: +process.env.PORT!,
    }),
    new RestateModule({
      server: {
        host: 'http://host.docker.internal',
        port: +process.env.RESTATE_PORT!,
      },
      event: {
        cluster: 'example',
        host: '0.0.0.0',
        port: +process.env.PORT!,
      },
      admin: {
        url: 'http://0.0.0.0:9070',
        deployOnStartup: true,
      },
      ingress: {
        url: 'http://0.0.0.0:8080',
      },
    }),
    new RestateEventsServerModule(),
  ],
}).run();
