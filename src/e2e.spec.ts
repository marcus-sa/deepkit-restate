import { createTestingApp } from '@deepkit/framework';
import { uuid, UUID } from '@deepkit/type';

import { RestateModule } from './restate.module';
import { restate } from './decorator';
import { RestateService } from './types';
import { RestateClient } from './restate-client';

test('e2e', async () => {
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

  const response = await fetch('http://localhost:9070/deployments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uri: 'http://localhost:9080' }),
  });
  expect(await response.json()).toMatchInlineSnapshot(`
    {
      "id": "dp_10Czkkq5p8GTv9yaxy5k39n",
      "services": [
        {
          "deployment_id": "dp_10Czkkq5p8GTv9yaxy5k39n",
          "instance_type": "Unkeyed",
          "methods": [
            {
              "input_type": "RpcRequest",
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

  const client = new RestateClient('http://localhost:8080', {
    authToken: '',
  });

  const user = client.service<UserServiceApi>();

  const result = await client.rpc(user.create('Test'));
  expect(result).toMatchInlineSnapshot(`
    User {
      "id": "69465c72-9269-4de9-b5e9-490c4c5a8cc3",
      "username": "Test",
    }
  `);
});
