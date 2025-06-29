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
import { RestateClient } from '../restate-client.js';
import { RestateEventPublisher } from './publisher.js';
import { RestateEventServerModule } from './server/module.js';
import { RestateEventSubscriber } from './subscriber.js';

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

      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9092,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
            event: {
              cluster: 'e2e',
            },
          }),
          new RestateEventServerModule({ autoDiscover: false, sse: false }),
        ],
        controllers: [CustomerService, AccountService],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateClient>();

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

      const app = createTestingApp({
        imports: [
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
            event: {
              cluster: 'e2e',
            },
          }),
          new RestateEventServerModule({ autoDiscover: false, sse: false }),
        ],
        controllers: [AccountService],
      });
      await app.startServer();

      const publisher = app.app
        .getInjectorContext()
        .get<RestateEventPublisher>();

      await publisher.publish([new CustomerCreated(new Customer('Test'))]);

      await sleep(1);

      expect(event).toBeInstanceOf(CustomerCreated);
    });
  });

  describe('sse', () => {
    test('publish and subscribe', async () => {
      const app = new App({
        imports: [
          new FrameworkModule({
            port: 9090,
          }),
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9091,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
            event: {
              cluster: 'e2e',
              host: 'localhost',
              port: 9090,
            },
          }),
          new RestateEventServerModule(),
        ],
      });
      const server = app.get<ApplicationServer>();
      await server.start();

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
