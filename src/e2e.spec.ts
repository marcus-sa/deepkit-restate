import { createTestingApp } from '@deepkit/framework';
import { PrimaryKey, Unique, uuid, UUID } from '@deepkit/type';
import { sleep } from '@deepkit/core';

import { RestateModule } from './restate.module.js';
import { RestateIngressClient } from './restate-ingress-client.js';
import { restate } from './decorator.js';
import {
  RestateService,
  RestateServiceContext,
  RestateSharedContext,
} from './types.js';
import { RestateMiddleware } from './middleware.js';
import { RestateClassMetadata, RestateHandlerMetadata } from './decorator.js';

describe('e2e', () => {
  describe('context', () => {
    test('call', async () => {
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
        'Account',
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

      interface UserService {
        create(username: string): Promise<User>;
      }

      type UserServiceApi = RestateService<'user', UserService>;

      @restate.service<UserServiceApi>()
      class UserService implements UserService {
        constructor(
          private readonly ctx: RestateServiceContext,
          private readonly account: AccountServiceApi,
        ) {}

        @restate.handler()
        async create(username: string): Promise<User> {
          const user = User.create(this.ctx, username);
          const account = await this.ctx.call(this.account.create(user));
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
              port: 9063,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [AccountService, UserService],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

      const user = client.service<UserServiceApi>();

      {
        const result = await client.call(user.create('Test'));
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
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserController],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

      const user = client.service<UserServiceApi>();

      {
        const result = await client.call(user.create('Test'));
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
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserController],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

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

    interface UserService {
      create(username: string): Promise<User>;
    }

    type UserServiceApi = RestateService<'user', UserService>;

    @restate.service<UserServiceApi>()
    class UserController implements UserService {
      constructor(private readonly ctx: RestateServiceContext) {}

      @restate.handler()
      async create(username: string): Promise<User> {
        return new User(username);
      }
    }

    test('call', async () => {
      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9086,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserController],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

      const user = client.service<UserServiceApi>();

      {
        const result = await client.call(user.create('Test'));
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
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserController],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

      const user = client.service<UserServiceApi>();

      {
        const status = await client.send(user.create('Test'));
        expect(status).toMatchObject({
          invocationId: expect.any(String),
          status: 'Accepted',
        });
      }
    });

    test('middleware', async () => {
      let middlewareExecuted = false;
      let contextReceived: RestateSharedContext | undefined;
      let classMetadataReceived: RestateClassMetadata | undefined;
      let handlerMetadataReceived: RestateHandlerMetadata | undefined;

      class TestMiddleware implements RestateMiddleware {
        async execute(
          ctx: RestateSharedContext,
          classMetadata: RestateClassMetadata,
          handlerMetadata?: RestateHandlerMetadata,
        ): Promise<void> {
          middlewareExecuted = true;
          contextReceived = ctx;
          classMetadataReceived = classMetadata;
          handlerMetadataReceived = handlerMetadata;
        }
      }

      @(restate.service<UserServiceApi>().middleware(TestMiddleware))
      class UserServiceWithMiddleware implements UserService {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
        async create(username: string): Promise<User> {
          return new User(username);
        }
      }

      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9088,
            },
            admin: {
              url: 'http://0.0.0.0:9070',
              deployOnStartup: true,
            },
            ingress: {
              url: 'http://0.0.0.0:8080',
            },
          }),
        ],
        controllers: [UserServiceWithMiddleware],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

      const user = client.service<UserServiceApi>();

      {
        const result = await client.call(user.create('Test'));
        expect(result).toBeInstanceOf(User);
        expect(result).toMatchObject({
          id: expect.any(String),
          username: 'Test',
        });
        expect(middlewareExecuted).toBe(true);
        expect(contextReceived).toBeDefined();
        expect(contextReceived).toHaveProperty('rand');
        expect(classMetadataReceived).toBeDefined();
        expect(classMetadataReceived?.name).toBe('user');
        expect(classMetadataReceived?.classType).toBe(UserServiceWithMiddleware);
        expect(handlerMetadataReceived).toBeDefined();
        expect(handlerMetadataReceived?.name).toBe('create');
      }
    });
  });
});
