import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { RestateModule } from '../src/restate.module.js';
import { RestateEventsSubscriber } from '../src/event/subscriber.js';
import { RestateEventsPublisher } from '../src/event/publisher.js';
import { UUID, uuid } from '@deepkit/type';

const app = new App({
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
        port: +process.env.EVENT_PORT!,
      },
      admin: {
        url: 'http://0.0.0.0:9070',
        deployOnStartup: true,
      },
      ingress: {
        url: 'http://0.0.0.0:8080',
      },
    }),
  ],
});

const subscriber = app.get<RestateEventsSubscriber>();
const publisher = app.get<RestateEventsPublisher>();

class User {
  id: UUID = uuid();
}

class UserCreatedEvent {
  user: User;

  constructor(user: User) {
    this.user = user;
  }
}

await subscriber.subscribe<UserCreatedEvent>(event => {
  console.log(event);
});

await publisher.publish([new UserCreatedEvent(new User())]);

await app.run();
