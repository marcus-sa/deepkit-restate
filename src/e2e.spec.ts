import { createTestingApp } from '@deepkit/framework';
import { uuid, UUID } from '@deepkit/type';

import { RestateModule } from './restate.module';
import { restate } from './decorator';
import { RestateKeyedContext, RestateService } from './types';
import { RestateClient } from './restate-client';

test('e2e', async () => {
  class User {
    readonly id: UUID = uuid();

    constructor(readonly username: string) {}
  }

  interface UserService {
    create(username: string): Promise<User>;
  }

  type UserServiceApi = RestateService<'user', UserService, { keyed: true }>;

  @restate.service<UserServiceApi>()
  class UserController implements UserService {
    constructor(private readonly ctx: RestateKeyedContext) {}

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
    const response = await fetch('http://0.0.0.0:9070/deployments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uri: 'http://host.docker.internal:9081' }),
    });
    expect(await response.json()).toMatchObject({
      services: [
        {
          name: 'user',
          instance_type: 'Keyed',
          methods: [
            {
              input_type: 'RpcRequest',
              key_field_number: 1,
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
    const result = await client.rpc(user.create('Test'), {
      key: uuid(),
    });
    expect(result).toBeInstanceOf(User);
    expect(result).toMatchObject({
      id: expect.any(String),
      username: 'Test',
    });
  }

  {
    const result = await client.send(user.create('Test'), {
      key: uuid(),
    });
    expect(result.id).toMatch(/^inv_/);
  }
});
