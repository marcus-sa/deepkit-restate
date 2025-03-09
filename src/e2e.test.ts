import { describe, expect, test } from 'bun:test';
import { sleep } from '@deepkit/core';
import { createTestingApp } from '@deepkit/framework';
import { PrimaryKey, UUID, Unique, uuid } from '@deepkit/type';

import { RestateClient } from './client.js';
import { RestateServiceContext } from './context.js';
import { restate } from './decorator.js';
import { RestateModule } from './module.js';
import { RestateService } from './types.js';

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

      interface AccountServiceHandlers {
        create(user: User): Promise<Account>;
      }

      type AccountServiceApi = RestateService<
        'account',
        AccountServiceHandlers
      >;

      @restate.service<AccountServiceApi>()
      class AccountService implements AccountServiceHandlers {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
        async create(user: User): Promise<Account> {
          expect(user).toBeInstanceOf(User);
          return Account.create(this.ctx, user);
        }
      }

      interface UserServiceHandlers {
        create(username: string): Promise<User>;
      }

      type UserServiceApi = RestateService<'user', UserServiceHandlers>;

      @restate.service<UserServiceApi>()
      class UserService implements UserServiceHandlers {
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
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9083,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserService, AccountService],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateClient>();

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

        constructor(public readonly username: string) {}
      }

      interface UserService {
        create(username: string): Promise<User>;
      }

      type UserServiceApi = RestateService<'user', UserService>;

      @restate.service<UserServiceApi>()
      class UserController implements UserService {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
        async create(username: string): Promise<User> {
          const user = await this.ctx.run<User>(
            'create user',
            () => new User(username),
          );
          expect(user).toBeInstanceOf(User);
          return user;
        }
      }

      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9084,
            },
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

      const client = app.app.getInjectorContext().get<RestateClient>();

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

        constructor(public readonly username: string) {}
      }

      interface UserService {
        create(username: string): Promise<void>;
      }

      type UserServiceApi = RestateService<'user', UserService>;

      @restate.service<UserServiceApi>()
      class UserController implements UserService {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
        async create(username: string): Promise<void> {
          const user = await this.ctx.run(
            'create user',
            () => new User(username),
          );
          expect(user).toBe(undefined);
        }
      }

      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9085,
            },
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

      const client = app.app.getInjectorContext().get<RestateClient>();

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
    test('rpc', async () => {});

    test('send', async () => {});
  });

  describe('service', async () => {
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

    test('rpc', async () => {
      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9086,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserService],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateClient>();

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
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9087,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserService],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateClient>();

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
