# Deepkit Restate
Deepkit Restate is a Restate integration for Deepkit, that makes it easy to work with Restate for Deepkit

This documentation assumes that you know how Restate works

Install the package
```
npm add deepkit-restate
```

Import module

```ts
import { FrameworkModule } from '@deepkit/framework';
import { RestateModule } from 'deepkit-restate';

const app = new App({
  imports: [
    new FrameworkModule(),
    new RestateModule({
      server: {
        host: 'http://localhost',
        port: 9080,
      },
      ingress: {
        url: 'http://localhost:8080',
      },
      event: {
        cluster: 'example',
        host: 'localhost',
        port: 9090,
      },
      admin: {
        url: 'http://0.0.0.0:9070',
        // will register new deployment version on startup
        deployOnStartup: true
      },
    })
  ],
});
```
the module can be used to configure the Restate server, ingress client, event bus, and admin client.
if server is not configured, the module will not provide a Restate server
if client is not configured, the module will not provide a Restate client.
if event is not configured, the module will not provide an event bus.
if admin is not configured, the module will not provide an admin client.

All serde is done via BSON.
> Working on an adapter for JSON serde

Communication between services is done via interfaces

### Client
library exposes a `RestateClient` that can be used to communicate with Ingress, and is what you use to call other services. it can either be instantiated by itself

```ts
import { RestateClient } from 'deepkit-restate';

const client = new RestateClient({
  url: 'http://localhost:9080',
});
```

or imported from the module when it has been configured
```ts
import { RestateClient } from 'deepkit-restate';

const client = app.get<RestateClient>();
```
the client is used both within and outside of an invocation context.
however it works differently. within an invocation context, it is durable, whereas outside it uses the ingress client.
outside of an invocation context, the client can also be used to instantiate proxies for objects and services allowing you to communicate with them.
service
```ts
const user = client.service<UserServiceApi>();
```
object
```ts
const user = client.object<UserObjectApi>();
```

the client expose two methods for communication

this is used for sending a request and waiting a response
```ts
client.call(user.create());
```

this is used for sending a request without waiting for the response.
```ts
client.send(user.create());
```
the last argument is options, that can be used to configure the delay
```ts
client.send(user.create(), { delay: '10s' });
```

when sending a request to a object, you have to provide the key as the first argument
```ts
client.call('key', user.create());
```
```ts
client.send('key', user.create());
```

defining a service

```ts
interface UserServiceHandlers {
  create(username: string): Promise<User>;
}

type UserServiceApi = RestateService<'user', UserServiceHandlers>;

// services are defined by decorating a class with @restate.service()
@restate.service<UserServiceApi>()
class UserService implements UserServiceHandlers {
  // the context can be accessed by injecting it into the constructor of your service
  constructor(private readonly ctx: RestateServiceContext) {
  }

  // handlers are defined by decorating a method with @restate.handler()
  @restate.handler()
  async create(username: string): Promise<User> {
    const user = User.create(this.ctx, username);
    return user;
  }
}
```

the first argument to the `RestateObject` and `RestateService` type is the name of the service/object, and is used to identify it in the network.

`RestateService` and `RestateObject` is how we define the api of a service/object. this way we can provide type safety when calling the service from another service, without needing to import the service class to reduce bundle size and circular dependencies.

similar, defining an object

```ts
interface UserServiceHandlers {
}

type UserServiceApi = RestateObject<'user', UserServiceHandlers>;

@restate.object<UserServiceApi>()
class UserService implements UserServiceHandlers {
}
```
you can define shared handlers by using the `@restate.shared().handler()` decorator (obs: there is no type safety for the shared context, it uses the same `RestateObjectContext`, so beware that `set` cannot be used at runtime)

now, if you want to call another service from within a handler, you can do so by injecting the client and proxy api into your service, and use the client and proxy to call the service
```ts
@restate.service<UserServiceApi>()
class UserService implements PaymentServiceInterface {
  constructor(
    private readonly client: RestateClient,
    // the proxy api will be injected into the service
    private readonly payment: PaymentServiceApi,
  ) {}

  @restate.handler()
  async create(user: User): Promise<void> {
    const payment = await this.client.call(this.payment.create('Test', user));
  }
}
```

when calling objects, you have to specify the key for the object
```ts
await this.client.call('key', this.payment.create('Test'));
```

using run blocks inside invocations
this also works with serde out of the box. if you provide a type argument to the run function, then it'll serde the return value. 
```ts
const user = await this.ctx.run<User>('create user', () => new User(username));
```
however, if you do not provide a type argument and return a value, then it'll return void (future improvement: throw an error instead).
```ts
const none = await this.ctx.run('create user', () => new User(username));
```

the same for awakeables
```ts
const awakeable = this.ctx.awakeable<User>();
```
```ts
const awakeable = this.ctx.resolveAwakeable<User>();
```

### events

there is also support for a pub/sub implementation in restate

it is preferred to use a separate application for the events server.
in a new application, setup the events server. it requires ingress, server and event to be cocnfigured

```ts
import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { RestateEventsServerModule } from 'deepkit-restate';

await new App({
  imports: [
    new FrameworkModule({
      port: 9090,
    }),
    new RestateModule({
      event: {
        cluster: 'example',
        host: 'localhost',
        port: 9090,
      },
      server: {
        host: 'http://localhost',
        port: 9080,
      },
      ingress: {
        url: 'http://localhost:8080',
      },
    }),
    new RestateEventsServerModule(),
  ],
}).run();
```

you can then in your providers, inject the publisher.
it works both within the invocation context
```ts
import { RestateEventsPublisher } from 'deepkit-restate';

@restate.service<UserServiceApi>()
export class UserService {
  constructor(private readonly publisher: RestateEventsPublisher) {}

  @restate.handler()
  async create(): Promise<void> {
    const user = new User();
    await this.publisher.publish([new UserCreatedEvent(user)]);
  }
}
```
and outside it. however publishing events outside of invocation context is not durable
```ts
const publisher = app.get<RestateEventsPublisher>();
const user = new User();
await this.publisher.publish([new UserCreatedEvent(user)]);
```

only classes are supported.
all events are versioned by hashing the type structure

you can then in any service (only services), define an event handler
```ts
@restate.service<UserServiceApi>()
export class UserService {
  @restate.event<UserCreatedEvent>().handler()
  async onUserCreated(event: UserCreatedEvent): Promise<void> {
    // handle event
  }
}
```
it is also possible to subscribe to events outside of the invocation context, such as when you want to forward events to the frontend from within a deepkit rpc controller action. it uses server-sent events (todo: deepkit broker bus) for this.
you can subscribe to a single event or multiple by providing `subscribe` with a union as type argument
```ts
const subscriber = app.get<RestateEventsSubscriber>();
const unsubscribe = await subscriber.subscribe<UserCreatedEvent>(event => {
  // handle event
});

await unsubscribe();
```


normal workflows are not yet supported.

the library also has built in support for sagas.

