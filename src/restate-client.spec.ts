import {describe,test,expect} from "bun:test";
import {uuid, UUID} from "@deepkit/type";
import {RestateService, RestateServiceContext} from "./types.js";
import {restate} from "./decorator.js";
import {createTestingApp} from "@deepkit/framework";
import {RestateModule} from "./restate.module.js";
import {RestateClient} from "./restate-client.js";

describe('RestateClient', () => {
  describe.todo('http', () => {

  });

  test.only('memory', async () => {
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

    const app = createTestingApp({
      imports: [new RestateModule()],
      controllers: [UserService],
    });
    const injector = app.app.getInjectorContext();

    const client = injector.get<RestateClient>();

    const userService = client.service<UserServiceApi>();
    expect(userService).toBeInstanceOf(UserService);
    const user = await client.rpc(userService.create('Test'));
    expect(user).toBeInstanceOf(User);
  });
})
