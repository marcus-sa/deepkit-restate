import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import {
  restate,
  RestateEventPublisher,
  RestateEventSubscriber,
  RestateModule,
  RestateService,
} from '../src/index.js';
import { UUID, uuid } from '@deepkit/type';
import { RestatePubSubServerModule } from '../src/event/server/module.js';
import { sleep } from '@deepkit/core';

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

interface Service1ApiHandlers {}

type Service1Api = RestateService<'one', Service1ApiHandlers>;

@restate.service<Service1Api>()
class Service1 {
  @(restate.event<CompanyCreatedEvent>().handler())
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

type Service3Api = RestateService<'three', {}>;

@restate.service<Service3Api>()
class Service3 {
  @(restate.event<UserCreatedEvent>().handler())
  async onUserCreatedEvent(event: UserCreatedEvent): Promise<void> {
    console.log('two', 'onUserCreatedEvent', new Date());
    receivedEventsCount++;
  }

  @(restate.event<CompanyCreatedEvent>().handler())
  async onCompanyCreatedEvent(event: CompanyCreatedEvent): Promise<void> {
    throw new Error('Failed');
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
    new RestatePubSubServerModule({
      sse: {
        hosts: ['localhost'],
      },
    }),
  ],
  controllers: [Service1, Service2, Service3],
});
app.run();

await sleep(1);

const publisher = app.get<RestateEventPublisher>();
const subscriber = app.get<RestateEventSubscriber>();

const iterations = 1;

let receivedSubscriptionsCount = 0;

await subscriber.subscribe<UserCreatedEvent>(() => {
  receivedSubscriptionsCount++;
});

console.time('total');

// await Promise.all(
//   Array.from({ length: iterations }).map(async () => {
//     await client.send(
//       service1.onUserCreatedEvent(new UserCreatedEvent(new User())),
//     );
//   }),
// );
// await waitUntil(() => {
//   return receivedEventsCount === iterations;
// }, 60_000 * 10);

for (let i = 0; i < iterations; i++) {
  {
    await publisher.publish([
      new UserCreatedEvent(new User()),
      new CompanyCreatedEvent(new Company()),
    ]);
  }
}
// await waitUntil(() => {
//   return (
//     receivedSubscriptionsCount === iterations &&
//     receivedEventsCount * 5 === iterations
//   );
// }, 60_000 * 10);

console.timeEnd('total');

// process.exit(0);
