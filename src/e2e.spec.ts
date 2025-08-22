import { createTestingApp } from '@deepkit/framework';
import { PrimaryKey, Unique, uuid, UUID } from '@deepkit/type';
import { sleep } from '@deepkit/core';

import { RestateModule } from './restate.module.js';
import { RestateIngressClient } from './client/restate-ingress-client.js';
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
        expect(classMetadataReceived?.classType).toBe(
          UserServiceWithMiddleware,
        );
        expect(handlerMetadataReceived).toBeDefined();
        expect(handlerMetadataReceived?.name).toBe('create');
      }
    });

    test('propagateIncomingHeaders', async () => {
      let receivedHeaders: Record<string, string> = {};

      class User {
        readonly id: UUID = uuid();

        constructor(public readonly username: string) {}
      }

      interface HeaderValidationServiceInterface {
        validateHeaders(): Promise<Record<string, string>>;
      }

      type HeaderValidationServiceApi = RestateService<
        'HeaderValidation',
        HeaderValidationServiceInterface
      >;

      @restate.service<HeaderValidationServiceApi>()
      class HeaderValidationService
        implements HeaderValidationServiceInterface
      {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
        async validateHeaders(): Promise<Record<string, string>> {
          // Capture the headers received by this service
          const headers = this.ctx.request().headers;
          receivedHeaders = { ...headers };
          return headers;
        }
      }

      interface UserServiceWithHeaders {
        createAndValidate(username: string): Promise<{
          user: User;
          headers: Record<string, string>;
        }>;
      }

      type UserServiceWithHeadersApi = RestateService<
        'UserWithHeaders',
        UserServiceWithHeaders
      >;

      @restate.service<UserServiceWithHeadersApi>()
      class UserServiceWithHeaders implements UserServiceWithHeaders {
        constructor(
          private readonly ctx: RestateServiceContext,
          private readonly headerValidation: HeaderValidationServiceApi,
        ) {}

        @restate.handler()
        async createAndValidate(username: string): Promise<{
          user: User;
          headers: Record<string, string>;
        }> {
          const user = new User(username);
          // Call another service - headers should be propagated
          const headers = await this.ctx.call(
            this.headerValidation.validateHeaders(),
          );
          return { user, headers };
        }
      }

      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9089,
              // Enable header propagation for specific headers
              propagateIncomingHeaders: [
                'x-correlation-id',
                'authorization',
                'x-tenant-id',
              ],
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
        controllers: [UserServiceWithHeaders, HeaderValidationService],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

      const userService = client.service<UserServiceWithHeadersApi>();

      // Make a call with custom headers
      const customHeaders = {
        'x-correlation-id': 'test-correlation-123',
        authorization: 'Bearer test-token',
        'x-tenant-id': 'tenant-456',
        'x-custom-header': 'should-not-propagate', // This should not be propagated
      };

      const result = await client.call(
        userService.createAndValidate('TestUser'),
        {
          headers: customHeaders,
        },
      );

      expect(result.user).toBeInstanceOf(User);
      expect(result.user.username).toBe('TestUser');

      // Verify that the specified headers were propagated
      expect(receivedHeaders['x-correlation-id']).toBe('test-correlation-123');
      expect(receivedHeaders['authorization']).toBe('Bearer test-token');
      expect(receivedHeaders['x-tenant-id']).toBe('tenant-456');

      // Verify that non-specified headers were NOT propagated
      expect(receivedHeaders['x-custom-header']).toBeUndefined();

      // Verify that the returned headers match what was received
      expect(result.headers['x-correlation-id']).toBe('test-correlation-123');
      expect(result.headers['authorization']).toBe('Bearer test-token');
      expect(result.headers['x-tenant-id']).toBe('tenant-456');
      expect(result.headers['x-custom-header']).toBeUndefined();
    });

    test('propagateIncomingHeaders with true (all headers)', async () => {
      let receivedHeaders: Record<string, string> = {};

      class User {
        readonly id: UUID = uuid();

        constructor(public readonly username: string) {}
      }

      interface HeaderValidationService2 {
        validateHeaders(): Promise<Record<string, string>>;
      }

      type HeaderValidationService2Api = RestateService<
        'HeaderValidation2',
        HeaderValidationService2
      >;

      @restate.service<HeaderValidationService2Api>()
      class HeaderValidationService2 implements HeaderValidationService2 {
        constructor(private readonly ctx: RestateServiceContext) {}

        @restate.handler()
        async validateHeaders(): Promise<Record<string, string>> {
          // Capture the headers received by this service
          const headers = this.ctx.request().headers;
          receivedHeaders = { ...headers };
          return headers;
        }
      }

      interface UserServiceWithAllHeaders {
        createAndValidate(username: string): Promise<{
          user: User;
          headers: Record<string, string>;
        }>;
      }

      type UserServiceWithAllHeadersApi = RestateService<
        'UserWithAllHeaders',
        UserServiceWithAllHeaders
      >;

      @restate.service<UserServiceWithAllHeadersApi>()
      class UserServiceWithAllHeaders implements UserServiceWithAllHeaders {
        constructor(
          private readonly ctx: RestateServiceContext,
          private readonly headerValidation: HeaderValidationService2Api,
        ) {}

        @restate.handler()
        async createAndValidate(username: string): Promise<{
          user: User;
          headers: Record<string, string>;
        }> {
          const user = new User(username);
          // Call another service - all headers should be propagated
          const headers = await this.ctx.call(
            this.headerValidation.validateHeaders(),
          );
          return { user, headers };
        }
      }

      const app = createTestingApp({
        imports: [
          new RestateModule({
            server: {
              host: 'http://host.docker.internal',
              port: 9090,
              // Enable propagation of ALL incoming headers
              propagateIncomingHeaders: true,
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
        controllers: [UserServiceWithAllHeaders, HeaderValidationService2],
      });
      await app.startServer();

      const client = app.app.getInjectorContext().get<RestateIngressClient>();

      const userService = client.service<UserServiceWithAllHeadersApi>();

      // Make a call with custom headers
      const customHeaders = {
        'x-correlation-id': 'test-correlation-456',
        authorization: 'Bearer test-token-2',
        'x-tenant-id': 'tenant-789',
        'x-custom-header': 'should-propagate-now',
      };

      const result = await client.call(
        userService.createAndValidate('TestUser2'),
        {
          headers: customHeaders,
        },
      );

      expect(result.user).toBeInstanceOf(User);
      expect(result.user.username).toBe('TestUser2');

      // When propagateIncomingHeaders is true, ALL headers should be propagated
      expect(receivedHeaders['x-correlation-id']).toBe('test-correlation-456');
      expect(receivedHeaders['authorization']).toBe('Bearer test-token-2');
      expect(receivedHeaders['x-tenant-id']).toBe('tenant-789');
      expect(receivedHeaders['x-custom-header']).toBe('should-propagate-now');

      // Verify that the returned headers match what was received
      expect(result.headers['x-correlation-id']).toBe('test-correlation-456');
      expect(result.headers['authorization']).toBe('Bearer test-token-2');
      expect(result.headers['x-tenant-id']).toBe('tenant-789');
      expect(result.headers['x-custom-header']).toBe('should-propagate-now');
    });
  });
});
