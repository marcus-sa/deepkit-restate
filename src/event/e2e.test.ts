import { expect, test } from 'bun:test';
import { createTestingApp } from '@deepkit/framework';
import { UUID, uuid } from '@deepkit/type';

import { RestateClient } from '../client.js';
import { restate } from '../decorator.js';
import { RestateModule } from '../module.js';
import { RestateService } from '../types.js';
import { RestateEventsPublisher } from './publisher.js';
import { RestateEventsServerModule } from './server/module.js';

test('event e2e', async () => {
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
    constructor(private readonly events: RestateEventsPublisher) {}

    @restate.handler()
    async create(name: string): Promise<Customer> {
      const customer = new Customer(name);
      await this.events.publish([new CustomerCreated(customer)]);
      return customer;
    }
  }

  interface AccountServiceHandlers {}

  type AccountServiceProxy = RestateService<'Account', AccountServiceHandlers>;

  @restate.service<AccountServiceProxy>()
  class AccountService implements AccountServiceHandlers {
    // @ts-ignore
    @(restate.event<CustomerCreated>().handler({ json: true }))
    async create(event: CustomerCreated) {
      expect(event).toBeInstanceOf(CustomerCreated);
    }
  }

  const app = createTestingApp({
    imports: [
      new RestateModule({
        server: {
          host: 'http://host.docker.internal',
          port: 9089,
        },
        admin: {
          url: 'http://0.0.0.0:9070',
        },
        ingress: {
          url: 'http://0.0.0.0:8080',
        },
        event: {
          cluster: 'e2e',
        },
      }),
      new RestateEventsServerModule(),
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
