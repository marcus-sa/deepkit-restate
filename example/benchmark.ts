import { App } from '@deepkit/app';
import { ApplicationServer, FrameworkModule } from '@deepkit/framework';
import {
  restate,
  RestateClient,
  RestateEventPublisher,
  RestateEventSubscriber,
  RestateModule,
  RestateService,
} from '../src/index.js';
import { UUID, uuid } from '@deepkit/type';
import { RestateEventServerModule } from '../src/event/server/module.js';
import { sleep } from '@deepkit/core';
import { waitUntil } from '../src/utils.js';

class Company {
  readonly id: UUID = uuid();
}

class CompanyCreatedEvent {
  readonly id: UUID = uuid();

  constructor(public company: Company) {}
}
class User {
  readonly id: UUID = uuid();
}

class UserCreatedEvent {
  readonly id: UUID = uuid();

  constructor(public user: User) {}
}

let receivedEventsCount: number = 0;

type Service1Api = RestateService<'one', {}>;

@restate.service<Service1Api>()
class Service1 {
  @(restate.event<UserCreatedEvent>().handler())
  async onUserCreatedEvent(event: UserCreatedEvent): Promise<void> {
    console.log('one', 'onUserCreatedEvent', new Date());
    receivedEventsCount++;
  }

  @(restate.event<CompanyCreatedEvent>().handler())
  async onCompanyCreatedEvent(event: CompanyCreatedEvent): Promise<void> {
    console.log('one', 'onCompanyCreatedEvent', new Date());
    receivedEventsCount++;
  }
}

type Service2Api = RestateService<'two', {}>;

@restate.service<Service2Api>()
class Service2 {
  @(restate.event<UserCreatedEvent>().handler())
  async onUserCreatedEvent(event: UserCreatedEvent): Promise<void> {
    console.log('two', 'onUserCreatedEvent', new Date());
    receivedEventsCount++;
  }

  @(restate.event<CompanyCreatedEvent>().handler())
  async onCompanyCreatedEvent(event: CompanyCreatedEvent): Promise<void> {
    console.log('two', 'onCompanyCreatedEvent', new Date());
    receivedEventsCount++;
  }
}

const app = new App({
  imports: [
    new FrameworkModule({
      port: 9096,
    }),
    new RestateModule({
      server: {
        host: 'http://host.docker.internal',
        port: 9095,
      },
      admin: {
        url: 'http://0.0.0.0:9070',
        deployOnStartup: true,
      },
      ingress: {
        url: 'http://0.0.0.0:8080',
      },
      event: {
        host: 'localhost',
        port: 9096,
      },
    }),
    new RestateEventServerModule({
      sse: {
        hosts: ['localhost'],
      },
    }),
  ],
  controllers: [Service1, Service2],
});
app.run();

await sleep(1);

const publisher = app.get<RestateEventPublisher>();
const subscriber = app.get<RestateEventSubscriber>();

const iterations = 300;

let receivedSubscriptionsCount = 0;

await subscriber.subscribe<UserCreatedEvent>(() => {
  receivedSubscriptionsCount++;
});

console.time('total');

for (let i = 0; i < iterations; i++) {
  {
    await publisher.publish([
      new UserCreatedEvent(new User()),
      new CompanyCreatedEvent(new Company()),
    ]);
  }
}

await waitUntil(() => {
  console.log({ receivedEventsCount, receivedSubscriptionsCount });
  return (
    receivedSubscriptionsCount === iterations &&
    receivedEventsCount === iterations * 4
  );
}, 60_000 * 10);

console.timeEnd('total');

process.exit(0);
