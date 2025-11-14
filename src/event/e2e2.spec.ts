import { ApplicationServer, FrameworkModule } from '@deepkit/framework';
import { uuid, UUID } from '@deepkit/type';
import { test } from 'vitest';
import { App } from '@deepkit/app';
import { sleep } from '@deepkit/core';

import { RestateModule } from '../restate.module.js';
import { RestateService, RestateServiceContext } from '../types.js';
import { restate } from '../decorator.js';
import { RestateIngressClient } from '../client/restate-ingress-client.js';
import { RestateEventPublisher } from './publisher.js';
import { RestatePubSubServerModule } from './server/module.js';

test('propagates headers from publisher to event handlers', async () => {
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

  interface AccountServiceHandlers {}

  type AccountServiceProxy = RestateService<'Account', AccountServiceHandlers>;

  let receivedHeaders: Record<string, string> = {};

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

  @restate.service<AccountServiceProxy>()
  class AccountService implements AccountServiceHandlers {
    constructor(private readonly ctx: RestateServiceContext) {}

    @(restate.event<CustomerCreated>().handler())
    async onCustomerCreated(event: CustomerCreated) {
      expect(event).toBeInstanceOf(CustomerCreated);
      // Capture headers from the event handler context
      receivedHeaders = Object.fromEntries(this.ctx.request().headers);
    }
  }

  const app = new App({
    imports: [
      new FrameworkModule({
        port: 9097,
      }),
      new RestateModule({
        server: {
          host: 'http://host.docker.internal',
          port: 9098,
          // Enable header propagation for specific headers
          propagateIncomingHeaders: ['x-correlation-id', 'authorization'],
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
            url: 'http://localhost:9097',
          },
        },
      }),
      new RestatePubSubServerModule({
        sse: {
          nodes: ['localhost:9097'],
        },
      }),
    ],
    controllers: [CustomerService, AccountService],
  });
  await app.get<ApplicationServer>().start();

  const client = app.get<RestateIngressClient>();
  const proxy = client.service<CustomerServiceProxy>();

  // Call the service with custom headers
  const customer = await client.call(proxy.create('Test'), {
    headers: {
      'x-correlation-id': 'test-correlation-123',
      authorization: 'Bearer test-token',
      'x-custom-header': 'should-not-propagate',
    },
  });

  expect(customer).toBeInstanceOf(Customer);

  // Wait a bit for the event to be processed
  await sleep(1);

  // Verify that the configured headers were propagated
  expect(receivedHeaders['x-correlation-id']).toBe('test-correlation-123');
  expect(receivedHeaders['authorization']).toBe('Bearer test-token');
  expect(receivedHeaders['x-restate-event']).toBe('CustomerCreated');

  // Verify that non-configured headers were not propagated
  expect(receivedHeaders['x-custom-header']).toBeUndefined();
});
