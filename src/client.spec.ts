import { describe, expect, test } from 'bun:test';
import { createTestingApp } from '@deepkit/framework';
import { UUID, uuid } from '@deepkit/type';

import { RestateClient } from './client.js';
import { RestateObjectContext, RestateServiceContext } from './context.js';
import { restate } from './decorator.js';
import { RestateModule } from './module.js';
import { RestateObject, RestateService } from './types.js';

describe('RestateClient', () => {
  // describe('http', () => {
  //
  // });

  describe('memory', async () => {
    describe('object', () => {
      const paymentId = uuid();

      class Payment {
        constructor(
          public readonly id: UUID,
          public readonly amount: number,
        ) {}
      }

      interface PaymentObjectHandlers {
        create(amount: number): Promise<Payment>;
      }

      type PaymentObjectApi = RestateObject<'user', PaymentObjectHandlers>;

      @restate.object<PaymentObjectApi>()
      class PaymentObject implements PaymentObjectHandlers {
        constructor(private readonly ctx: RestateObjectContext) {}

        @restate.handler()
        async create(amount: number): Promise<Payment> {
          return new Payment(this.ctx.key, amount);
        }
      }
      test(
        'rpc',
        async () => {
          const app = createTestingApp({
            imports: [
              new RestateModule({
                run: {
                  retryIntervalFactor: 0,
                  maxRetryIntervalMillis: 0,
                  initialRetryIntervalMillis: 0,
                  maxRetryDurationMillis: 0,
                  maxRetryAttempts: 0,
                },
              }),
            ],
            controllers: [PaymentObject],
          });
          const injector = app.app.getInjectorContext();

          const client = injector.get<RestateClient>();

          const paymentObject = client.object<PaymentObjectApi>();
          const payment = await client.rpc(
            paymentId,
            paymentObject.create(10.0),
          );
          // expect(payment).toBeInstanceOf(Payment);
          expect(payment).toMatchObject({
            id: paymentId,
            amount: 10.0,
          });
        },
        { timeout: 10_000 },
      );
    });

    describe('service', () => {
      class User {
        readonly id: UUID = uuid();

        constructor(public readonly username: string) {}
      }

      interface UserServiceHandlers {
        create(username: string): Promise<User>;
      }

      type UserServiceApi = RestateService<'user', UserServiceHandlers>;

      @restate.service<UserServiceApi>()
      class UserService implements UserServiceHandlers {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
        async create(username: string): Promise<User> {
          return new User(username);
        }
      }

      // test('send', async () => {
      //   const app = createTestingApp({
      //     imports: [new RestateModule()],
      //     controllers: [UserService],
      //   });
      //   const injector = app.app.getInjectorContext();
      //
      //   const client = injector.get<RestateClient>();
      //
      //   const userService = client.service<UserServiceApi>();
      //   expect(userService).toBeInstanceOf(UserService);
      //   const user = await client.send(userService.create('Test'));
      //   await sleep(1);
      //   expect(user).toBeInstanceOf(User);
      // });

      test('rpc', async () => {
        const app = createTestingApp({
          imports: [new RestateModule()],
          controllers: [UserService],
        });
        const injector = app.app.getInjectorContext();

        const client = injector.get<RestateClient>();

        const userService = client.service<UserServiceApi>();
        const user = await client.rpc(userService.create('Test'));
        expect(user).toBeInstanceOf(User);
      });
    });
  });
});
