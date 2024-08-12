import { createTestingApp, TestingFacade } from '@deepkit/framework';
import { PrimaryKey, Unique, uuid, UUID } from '@deepkit/type';
import { sleep } from '@deepkit/core';

import { RestateModule } from './restate.module.js';
import { restate } from './decorator.js';
import { RestateService, RestateServiceContext } from './types.js';
import { RestateClient } from './restate-client.js';
import { RestateAdminClient } from './restate-admin-client.js';

const client = new RestateClient({ url: 'http://0.0.0.0:8080' });
const admin = new RestateAdminClient({ url: 'http://0.0.0.0:9070' });

describe('e2e', () => {
  describe('context', () => {
    test('rpc', async () => {
      class Account {
        static create(ctx: RestateServiceContext, user: User): Account {
          return new Account(ctx.rand.uuidv4(), user.id);
        }

        constructor(
          public readonly id: UUID,
          public readonly userId: User['id'] & Unique,
        ) {}
      }

      class User {
        static create(ctx: RestateServiceContext, username: string): User {
          return new User(ctx.rand.uuidv4(), username);
        }

        readonly accountId?: Account['id'] & Unique;

        constructor(
          public readonly id: UUID,
          public readonly username: string,
        ) {}

        setAccount(account: Account): void {
          // noinspection TypeScriptValidateTypes
          Object.assign(this, { accountId: account.id });
        }
      }

      interface AccountService {
        create(user: User): Promise<Account>;
      }

      type AccountServiceApi = RestateService<'account', AccountService>;

      @restate.service<AccountServiceApi>()
      class AccountController implements AccountService {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
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
          private readonly ctx: RestateServiceContext,
          private readonly account: AccountServiceApi,
        ) {}

        @restate.handler()
        async create(username: string): Promise<User> {
          const user = User.create(this.ctx, username);
          const account = await this.ctx.rpc(this.account.create(user));
          expect(account).toBeInstanceOf(Account);
          user.setAccount(account);
          return user;
        }
      }

      const app = createTestingApp({
        imports: [new RestateModule({ port: 9082 })],
        controllers: [UserController, AccountController],
      });
      void app.startServer();

      await admin.deployments.create('http://host.docker.internal:9082');

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

    test('run 1', async () => {
      class User {
        readonly id: UUID & PrimaryKey = uuid();

        constructor(public readonly username: string) {
        }
      }

      interface UserService {
        create(username: string): Promise<User>;
      }

      type UserServiceApi = RestateService<'user', UserService>;

      @restate.service<UserServiceApi>()
      class UserController implements UserService {
        constructor(private readonly ctx: RestateServiceContext) {
        }

        @restate.handler()
        async create(username: string): Promise<User> {
          const user = await this.ctx.run<User>(() => new User(username));
          expect(user).toBeInstanceOf(User);
          return user;
        }
      }

      const app = createTestingApp({
        imports: [
          new RestateModule({
            host: 'http://host.docker.internal',
            port: 9086,
            admin: {
              url: 'http://0.0.0.0:9070',
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserController],
      });
      await app.startServer();

      const user = client.service<UserServiceApi>();

      {
        const result = await client.rpc(user.create('Test'));
        expect(result).toBeInstanceOf(User);
        expect(result).toMatchObject({
          id: expect.any(String),
          username: 'Test',
        });
      }
    });

    test('run 2', async () => {
      class User {
        readonly id: UUID & PrimaryKey = uuid();

        constructor(public readonly username: string) {
        }
      }

      interface UserService {
        create(username: string): Promise<void>;
      }

      type UserServiceApi = RestateService<'user', UserService>;

      @restate.service<UserServiceApi>()
      class UserController implements UserService {
        constructor(private readonly ctx: RestateServiceContext) {
        }

        @restate.handler()
        async create(username: string): Promise<void> {
          const user = await this.ctx.run(() => new User(username));
          expect(user).toBe(undefined);
        }
      }

      const app = createTestingApp({
        imports: [
          new RestateModule({
            host: 'http://host.docker.internal',
            port: 9085,
            admin: {
              url: 'http://0.0.0.0:9070',
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserController],
      });
      await app.startServer();

      const user = client.service<UserServiceApi>();

      {
        const status = await client.send(user.create('Test'));
        expect(status).toMatchObject({
          invocationId: expect.any(String),
          status: 'Accepted',
        });
      }

      // wait for handler to be invoked
      await sleep(3);
    });
  });

  describe('object', () => {
    test('rpc', async () => {
    });

    test('send', async () => {
    });
  });

  describe('service', async () => {
    class User {
      readonly id: UUID = uuid();

      constructor(public readonly username: string) {
      }
    }

    interface UserService {
      create(username: string): Promise<User>;
    }

    type UserServiceApi = RestateService<'user', UserService>;

    @restate.service<UserServiceApi>()
    class UserController implements UserService {
      constructor(private readonly ctx: RestateServiceContext) {
      }

      @restate.handler()
      async create(username: string): Promise<User> {
        return new User(username);
      }
    }

    let app: TestingFacade<any>;

    beforeEach(() => {
      app = createTestingApp({
        imports: [new RestateModule({ port: 9081 })],
        controllers: [UserController],
      });
      void app.startServer();
    });

    afterEach(() => app.stopServer());

    test('rpc', async () => {
      await admin.deployments.create('http://host.docker.internal:9081');

      const user = client.service<UserServiceApi>();

      {
        const result = await client.rpc(user.create('Test'));
        expect(result).toBeInstanceOf(User);
        expect(result).toMatchObject({
          id: expect.any(String),
          username: 'Test',
        });
      }
    });

    test('send', async () => {
      const app = createTestingApp({
        imports: [new RestateModule({ port: 9081 })],
        controllers: [UserController],
      });
      void app.startServer();

      await admin.deployments.create('http://host.docker.internal:9081');

      const user = client.service<UserServiceApi>();

      {
        const status = await client.send(user.create('Test'));
        expect(status).toMatchObject({
          invocationId: expect.any(String),
          status: 'Accepted',
        });
      }
    });
  });
});
