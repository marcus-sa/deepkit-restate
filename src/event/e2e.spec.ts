import {
  ApplicationServer,
  createTestingApp,
  FrameworkModule,
} from '@deepkit/framework';
import { uuid, UUID } from '@deepkit/type';
import { describe, test } from 'vitest';
import { App } from '@deepkit/app';
import { sleep } from '@deepkit/core';

import { RestateModule } from '../restate.module.js';
import { RestateService } from '../types.js';
import { restate } from '../decorator.js';
import { RestateIngressClient } from '../client/restate-ingress-client.js';
import { RestateEventPublisher } from './publisher.js';
import { RestatePubSubServerModule } from './server/module.js';
import { RestateEventSubscriber } from './subscriber.js';
import {
  HttpMiddleware,
  HttpRequest,
  HttpResponse,
  HttpUnauthorizedError,
} from '@deepkit/http';

describe('event', () => {
  describe('handler', () => {
    test('publish inside invocation', async () => {
      class Customer {
        readonly id: UUID = uuid();

        constructor(readonly name: string) {}
      }

      class CustomerCreated {
        constructor(readonly customer: Customer) {}
      }

      interface CustomerServiceHandlers {
        create(name: string): Promise<Customer>;
      }

      type CustomerServiceProxy = RestateService<
        'Customer',
        CustomerServiceHandlers
      >;

      @restate.service<CustomerServiceProxy>()
      class CustomerService implements CustomerServiceHandlers {
        constructor(private readonly events: RestateEventPublisher) {}

        @restate.handler()
        async create(name: string): Promise<Customer> {
          const customer = new Customer(name);
          await this.events.publish([new CustomerCreated(customer)]);
          return customer;
        }
      }

      interface AccountServiceHandlers {}

      type AccountServiceProxy = RestateService<
        'Account',
        AccountServiceHandlers
      >;

      @restate.service<AccountServiceProxy>()
      class AccountService implements AccountServiceHandlers {
        @(restate.event<CustomerCreated>().handler())
        async create(event: CustomerCreated) {
          expect(event).toBeInstanceOf(CustomerCreated);
        }
      }

      const app = new App({
        imports: [
          new FrameworkModule({
            port: 9083,
          }),
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9084,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
            pubsub: {
              sse: {
                url: 'http://localhost:9093',
              },
            },
          }),
          new RestatePubSubServerModule({
            sse: {
              nodes: ['localhost:9083'],
            },
          }),
        ],
        controllers: [CustomerService, AccountService],
      });
      await app.get<ApplicationServer>().start();

      const client = app.get<RestateIngressClient>();

      const proxy = client.service<CustomerServiceProxy>();

      {
        const customer = await client.call(proxy.create('Test'));
        expect(customer).toBeInstanceOf(Customer);
      }
    });

    test('publish outside invocation', async () => {
      class Customer {
        readonly id: UUID = uuid();

        constructor(readonly name: string) {}
      }

      class CustomerCreated {
        constructor(readonly customer: Customer) {}
      }

      interface AccountServiceHandlers {}

      type AccountServiceProxy = RestateService<
        'Account',
        AccountServiceHandlers
      >;

      let event: CustomerCreated | undefined;

      @restate.service<AccountServiceProxy>()
      class AccountService implements AccountServiceHandlers {
        @(restate.event<CustomerCreated>().handler())
        async create(_event: CustomerCreated) {
          expect(_event).toBeInstanceOf(CustomerCreated);
          event = _event;
        }
      }

      const app = new App({
        imports: [
          new FrameworkModule({
            port: 9092,
          }),
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9093,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
            pubsub: {
              sse: {
                url: 'http://localhost:7092',
              },
            },
          }),
          new RestatePubSubServerModule({
            sse: {
              nodes: ['localhost:9092'],
            },
          }),
        ],
        controllers: [AccountService],
      });
      await app.get<ApplicationServer>().start();

      const publisher = app.get<RestateEventPublisher>();

      await publisher.publish([new CustomerCreated(new Customer('Test'))]);

      await sleep(1);

      expect(event).toBeInstanceOf(CustomerCreated);
    });

    test.only('union types event handler', async () => {
      class Customer {
        readonly id: UUID = uuid();

        constructor(public readonly name: string) {}
      }

      class CustomerCreated {
        constructor(public readonly customer: Customer) {}
      }

      class CustomerUpdated {
        constructor(public readonly customer: Customer) {}
      }

      interface AccountServiceHandlers {}

      type AccountServiceProxy = RestateService<
        'Account',
        AccountServiceHandlers
      >;

      let event: CustomerCreated | CustomerUpdated | undefined;

      @restate.service<AccountServiceProxy>()
      class AccountService implements AccountServiceHandlers {
        // needs discriminators
        @(restate.event<CustomerCreated | CustomerUpdated>().handler())
        async create(_event: CustomerCreated | CustomerUpdated) {
          console.log('event', event);
          event = _event;
        }
      }

      const app = new App({
        imports: [
          new FrameworkModule({
            port: 9020,
          }),
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9093,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
            pubsub: {
              sse: {
                url: 'http://localhost:9020',
              },
            },
          }),
          new RestatePubSubServerModule({
            sse: {
              nodes: ['localhost:9020'],
            },
          }),
        ],
        controllers: [AccountService],
      });
      await app.get<ApplicationServer>().start();

      const publisher = app.get<RestateEventPublisher>();

      await publisher.publish([new CustomerCreated(new Customer('Test'))]);

      await sleep(1);

      console.log(event);

      expect(event).toBeInstanceOf(CustomerCreated);

      await publisher.publish([new CustomerUpdated(new Customer('Test'))]);

      await sleep(1);

      console.log(event);

      expect(event).toBeInstanceOf(CustomerUpdated);
    });
  });

  describe('sse', () => {
    describe('middleware', () => {
      test('restrict stream access', async () => {
        let requests = 0;

        class EventsMiddleware implements HttpMiddleware {
          execute(
            req: HttpRequest,
            res: HttpResponse,
            next: (err?: any) => void,
          ) {
            requests++;
            if (requests === 2) {
              throw new HttpUnauthorizedError('Unauthorized');
            }
            next();
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
              pubsub: {
                sse: {
                  url: 'http://localhost:9096',
                },
              },
            }),
            new RestatePubSubServerModule({
              sse: {
                nodes: ['localhost:9096'],
              },
            }).configureMiddlewareForServerSentEvents(EventsMiddleware),
          ],
        });
        await app.get<ApplicationServer>().start();

        const publisher = app.get<RestateEventPublisher>();
        const subscriber = app.get<RestateEventSubscriber>();

        class User {
          readonly id: UUID = uuid();
        }

        class UserCreatedEvent {
          constructor(public user: User) {}
        }

        const fn1 = vi.fn();

        await subscriber.subscribe<UserCreatedEvent>(fn1, {
          stream: 'company1',
        });

        const fn2 = vi.fn();

        await subscriber.subscribe<UserCreatedEvent>(fn2, {
          stream: 'company1',
        });

        await publisher.publish([new UserCreatedEvent(new User())], {
          stream: 'company1',
        });

        await sleep(1);

        expect(fn1).toHaveBeenCalled();
        expect(fn2).not.toHaveBeenCalled();
      });
    });

    test('subscribers only receive events from their stream', async () => {
      const app = new App({
        imports: [
          new FrameworkModule({
            port: 10096,
          }),
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 10095,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
            pubsub: {
              sse: {
                url: 'http://localhost:10096',
              },
            },
          }),
          new RestatePubSubServerModule({
            sse: {
              nodes: ['localhost:10096'],
            },
          }),
        ],
      });
      await app.get<ApplicationServer>().start();

      const publisher = app.get<RestateEventPublisher>();
      const subscriber = app.get<RestateEventSubscriber>();

      class User {
        readonly id: UUID = uuid();
      }

      class UserCreatedEvent {
        constructor(public user: User) {}
      }

      const fn1 = vi.fn();
      await subscriber.subscribe<UserCreatedEvent>(fn1, {
        stream: 'company1',
      });

      const fn2 = vi.fn();
      await subscriber.subscribe<UserCreatedEvent>(fn2, {
        stream: 'company2',
      });

      await publisher.publish([new UserCreatedEvent(new User())], {
        stream: 'company1',
      });

      await sleep(1);

      expect(fn1).toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    });

    test('publish and subscribe works outside invocation context', async () => {
      const app = new App({
        imports: [
          new FrameworkModule({
            port: 9081,
          }),
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9082,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
            pubsub: {
              sse: {
                url: 'http://localhost:9081',
              },
            },
          }),
          new RestatePubSubServerModule({
            sse: {
              nodes: ['localhost:9081'],
            },
          }),
        ],
      });
      await app.get<ApplicationServer>().start();

      const publisher = app.get<RestateEventPublisher>();
      const subscriber = app.get<RestateEventSubscriber>();

      class User {
        readonly id: UUID = uuid();
      }

      class UserCreatedEvent {
        constructor(public user: User) {}
      }

      const fn = vi.fn().mockImplementation(event => {
        expect(event).toBeInstanceOf(UserCreatedEvent);
        expect(event.user).toBeInstanceOf(User);
      });

      const unsubscribe = await subscriber.subscribe<UserCreatedEvent>(fn);

      await publisher.publish([new UserCreatedEvent(new User())]);

      await sleep(1);

      expect(fn).toHaveBeenCalled();
    });
  });
});
