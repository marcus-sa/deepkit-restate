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
    imports: [new RestateModule()],
    controllers: [UserController],
  });
  void app.startServer();

  const response = await fetch('http://0.0.0.0:9070/deployments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uri: 'http://0.0.0.0:9080' }),
  });
  expect(await response.json()).toMatchInlineSnapshot(`
    {
      "id": "dp_16WOCWdvHvijJpuoQtGGmJj",
      "services": [
        {
          "deployment_id": "dp_16WOCWdvHvijJpuoQtGGmJj",
          "instance_type": "Keyed",
          "methods": [
            {
              "input_type": "RpcRequest",
              "key_field_number": 1,
              "name": "create",
              "output_type": "RpcResponse",
            },
          ],
          "name": "user",
          "public": true,
          "revision": 9,
        },
      ],
    }
  `);

  const client = new RestateClient('http://0.0.0.0:8080');

  const user = client.service<UserServiceApi>();

  const result = await client.rpc(user.create('Test'), {
    key: uuid(),
  });
  expect(result).toMatchInlineSnapshot(`
    User {
      "id": "6e4183dd-aac7-48a5-ab81-28943ae13a3d",
      "username": "Test",
    }
  `);
});
