import { createTestingApp } from '@deepkit/framework';
import { integer, Unique, uuid, UUID } from '@deepkit/type';

import { RestateModule } from './restate.module.js';
import { restate } from './decorator.js';
import { RestateContext, RestateService } from './types.js';
import { RestateClient } from './restate-client.js';

async function createDeployment(port: number): Promise<Response> {
  const response = await fetch('http://0.0.0.0:9070/deployments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uri: `http://host.docker.internal:${port}` }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response;
}

describe('e2e', () => {
  describe('context', () => {
    test('rpc', async () => {
      class Account {
        static create(ctx: RestateContext, user: User): Account {
          return new Account(ctx.rand.uuidv4(), user.id);
        }

        constructor(
          readonly id: UUID,
          readonly userId: User['id'] & Unique,
        ) {}
      }

      class User {
        static create(ctx: RestateContext, username: string): User {
          return new User(ctx.rand.uuidv4(), username);
        }

        readonly accountId?: Account['id'] & Unique;

        constructor(
          readonly id: UUID,
          readonly username: string,
        ) {}

        setAccount(account: Account): void {
          (this as any).accountId = account.id;
        }
      }

      interface AccountService {
        create(user: User): Promise<Account>;
      }

      type AccountServiceApi = RestateService<'account', AccountService>;

      @restate.service<AccountServiceApi>()
      class AccountController implements AccountService {
        constructor(private readonly ctx: RestateContext) {}

        @restate.method()
        async create(user: User): Promise<Account> {
          expect(user).toBeInstanceOf(User);
          return Account.create(this.ctx, user);
        }
      }

      interface UserService {
        create(username: string): Promise<User>;
      }

      type UserServiceApi = RestateService<'user', UserService>;

      @restate.service<UserServiceApi>()
      class UserController implements UserService {
        constructor(
          private readonly ctx: RestateContext,
          private readonly account: AccountServiceApi,
        ) {}

        @restate.method()
        async create(username: string): Promise<User> {
          const user = User.create(this.ctx, username);
          const account = await this.ctx.rpc(this.account.create(user));
          user.setAccount(account);
          return user;
        }
      }

      const app = createTestingApp({
        imports: [new RestateModule({ port: 9082 })],
        controllers: [UserController, AccountController],
      });
      void app.startServer();

      await createDeployment(9082);

      const client = new RestateClient('http://0.0.0.0:8080');

      const user = client.service<UserServiceApi>();

      {
        const result = await client.rpc(user.create('Test'));
        expect(result).toBeInstanceOf(User);
        expect(result).toMatchObject({
          id: expect.any(String),
          username: 'Test',
          accountId: expect.any(String),
        });
      }
    });
  });

  describe('service', () => {
    test('unkeyed', async () => {
      class User {
        readonly id: UUID = uuid();

        constructor(readonly username: string) {}
      }

      interface UserService {
        create(username: string): Promise<User>;
      }

      type UserServiceApi = RestateService<'user', UserService>;

      @restate.service<UserServiceApi>()
      class UserController implements UserService {
        constructor(private readonly ctx: RestateContext) {}

        @restate.method()
        async create(username: string): Promise<User> {
          return new User(username);
        }
      }

      const app = createTestingApp({
        imports: [new RestateModule({ port: 9081 })],
        controllers: [UserController],
      });
      void app.startServer();

      {
        const response = await createDeployment(9081);
        expect(await response.json()).toMatchObject({
          services: [
            {
              name: 'user',
              instance_type: 'Unkeyed',
              methods: [
                {
                  input_type: 'RpcRequest',
                  name: 'create',
                  output_type: 'RpcResponse',
                },
              ],
            },
          ],
        });
      }

      const client = new RestateClient('http://0.0.0.0:8080');

      const user = client.service<UserServiceApi>();

      {
        const result = await client.rpc(user.create('Test'));
        expect(result).toBeInstanceOf(User);
        expect(result).toMatchObject({
          id: expect.any(String),
          username: 'Test',
        });
      }

      {
        const result = await client.send(user.create('Test'));
        expect(result.id).toMatch(/^inv_/);
      }
    });
  });
});
