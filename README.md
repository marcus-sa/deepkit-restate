# Deepkit Restate

**Deepkit Restate** is a seamless [Restate](https://restate.dev) integration for [Deepkit](https://deepkit.io). It enables effortless communication between distributed services using durable invocations, service interfaces, and event-driven architecture.

> This documentation assumes familiarity with Restate's concepts and lifecycle.

---

## Installation

```bash
npm add deepkit-restate
```

---

## Module Setup

To use Deepkit Restate, import the `RestateModule` and provide configuration for the components you need:

```ts
import { FrameworkModule } from '@deepkit/framework';
import { RestateModule } from 'deepkit-restate';
import { App } from '@deepkit/app';

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
        deployOnStartup: true,
      },
    }),
  ],
});
```

You can configure any combination of the following:

* **server**: Starts a Restate server
* **ingress**: Enables outbound service calls
* **event**: Enables pub/sub event system
* **admin**: Registers deployments with the admin interface

> If a section is not configured, that functionality will not be available.

---

## Serialization (Serde) and Error Handling

All serialization and deserialization in Deepkit Restate is handled via **BSON** by default.

This means you can **return** and **accept** any types in your service handlers or saga steps, including:

* Primitives (`string`, `number`, `boolean`, etc.)
* Plain objects (`{ name: string; age: number }`)
* Class instances (with properties and methods)
* Complex nested types and arrays
* Custom types supported by BSON serialization

The serialization system preserves type fidelity and structure when encoding and decoding data across the network.

### Automatic Error Forwarding and Serialization

* If an error is **thrown** inside a handler or saga step, it is automatically serialized and forwarded to the caller.
* This allows errors to be **caught** remotely, preserving the error information.
* **Custom errors with type information** are supported and **will not be retried** automatically by the system, enabling precise control over error handling and retries.

> We are actively working on an adapter to support JSON serialization as an alternative to BSON.

---

## Calling Services

### `RestateClient`

The `RestateClient` handles communication between services and objects. It behaves differently depending on whether it is used within or outside an invocation context.

You can create a client manually:

```ts
import { RestateClient } from 'deepkit-restate';

const client = new RestateClient({ url: 'http://localhost:9080' });
```

Or retrieve the configured instance via DI:

```ts
const client = app.get<RestateClient>();
```

### Using the Client

To create a proxy to a **service**:

```ts
const user = client.service<UserServiceApi>();
```

To create a proxy to an **object**:

```ts
const user = client.object<UserObjectApi>();
```

### Invoking Methods

Durable request (waits for a result):

```ts
await client.call(user.create());
```

Fire-and-forget (does not wait for result):

```ts
await client.send(user.create());
```

You can configure delivery options:

```ts
await client.send(user.create(), { delay: '10s' });
```

For object calls, specify the key:

```ts
await client.call('user-key', user.create());
await client.send('user-key', user.create());
```

---

## Defining Services and Objects

### Services

```ts
interface UserServiceHandlers {
  create(username: string): Promise<User>;
}

type UserServiceApi = RestateService<'user', UserServiceHandlers>;

@restate.service<UserServiceApi>()
class UserService implements UserServiceHandlers {
  constructor(private readonly ctx: RestateServiceContext) {}

  @restate.handler()
  async create(username: string): Promise<User> {
    return User.create(this.ctx, username);
  }
}
```

* Use `@restate.service()` to define a service.
* Use `@restate.handler()` define handlers.
* The context (`RestateServiceContext`) provides durable execution helpers.

### Objects

```ts
interface UserObjectHandlers {}

type UserObjectApi = RestateObject<'user', UserObjectHandlers>;

@restate.object<UserObjectApi>()
class UserObject implements UserObjectHandlers {}
```

Use `@restate.object()` to define virtual objects.

> Shared handlers can be declared using `@restate.shared().handler()`.
> **Note:** Shared handlers use the object context, which is not type-safe. Avoid using `ctx.set()` at runtime in shared handlers.

---

## Dependency Injection: Calling Other Services

You can inject the client and proxy APIs into a service:

```ts
@restate.service<UserServiceApi>()
class UserService {
  constructor(
    private readonly client: RestateClient,
    private readonly payment: PaymentServiceApi,
  ) {}

  @restate.handler()
  async create(user: User): Promise<void> {
    await this.client.call(this.payment.create('Test', user));
  }
}
```

For objects, remember to provide a key:

```ts
await this.client.call('payment-id', this.payment.create('Test'));
```

---

## Durable Helpers

### `run` blocks

The `ctx.run()` helper ensures a block is executed durably:

```ts
const user = await this.ctx.run<User>('create user', () => new User(username));
```

Without a type argument, the return value is ignored:

```ts
await this.ctx.run('log something', () => console.log('hello'));
```

### Awakeables

Used to pause and resume execution:

```ts
const awakeable = this.ctx.awakeable<User>();
```

To resume:

```ts
this.ctx.resolveAwakeable<User>();
```

### Durable State

Store and retrieve durable state using the context:
```ts
await this.ctx.set<User>('user', user);
```
```ts
const user = await this.ctx.get<User>('user');

```

---

## Events

### Server Setup

Set up a dedicated application for handling events. Requires the `event`, `server`, and `ingress` configurations:

```ts
import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { RestateEventsServerModule, RestateModule } from 'deepkit-restate';

await new App({
  imports: [
    new FrameworkModule({ port: 9090 }),
    new RestateModule({
      server: { host: 'http://localhost', port: 9080 },
      ingress: { url: 'http://localhost:8080' },
      event: { cluster: 'example', host: 'localhost', port: 9090 },
    }),
    new RestateEventsServerModule(),
  ],
}).run();
```

### Publishing Events

Inside a service handler (durable):

```ts
constructor(private readonly publisher: RestateEventsPublisher) {}

await this.publisher.publish([new UserCreatedEvent(user)]);
```

Outside of invocation (non-durable):

```ts
const publisher = app.get<RestateEventsPublisher>();
await publisher.publish([new UserCreatedEvent(user)]);
```

> Only classes are supported as events.

> Events are versioned by hashing their structure.

### Handling Events

Only services can define event handlers:

```ts
@restate.service<UserServiceApi>()
class UserService {
  @restate.event<UserCreatedEvent>().handler()
  async onUserCreated(event: UserCreatedEvent): Promise<void> {
    // handle event
  }
}
```

### SSE Delivery

Server-Sent Events (SSE) allow real-time delivery of events to connected subscribers.

#### Subscribing to Events Outside of Services
Subscribe to events from contexts like HTTP or RPC controllers:

```ts
const subscriber = app.get<RestateEventsSubscriber>();

const unsubscribe = await subscriber.subscribe<UserCreatedEvent>(event => {
  // handle event
});

await unsubscribe();
```

You can also use union types to subscribe to multiple events.


#### Configuration (Global)

You can configure global SSE delivery behavior in `RestateEventsServerModule`:

```ts
new RestateEventsServerModule({
  sse: {
    all: true,
    autoDiscover: true,
    hosts: [
      'http://events-1.internal:9090',
      'http://events-2.internal:9090',
    ],
  },
});
``` 

| Option             | Type        | Description                                                                   |
| ------------------ |-------------| ----------------------------------------------------------------------------- |
| `sse.all`          | `boolean`   | If `true`, all published events will be delivered via SSE by default.         |
| `sse.autoDiscover` | `boolean`   | When enabled, resolves peer IPs via DNS to fan out SSE events to other nodes. |
| `sse.hosts`        | `string[]`  | List of peer event server URLs for fan-out (used with `autoDiscover`).        |

> SSE fan-out is stateless and opportunistic. Each node will attempt to push matching events to other known nodes.

#### Overriding per Publish

You can override the global SSE setting by passing `{ sse: true }` in the publish options:

```ts
await publisher.publish([new UserCreatedEvent(user)], {
  sse: true,
});
```

Behavior summary:

* If `sse.all` is **true**, SSE is used by default unless explicitly disabled.
* If `sse.all` is **false**, SSE is off by default — but you can still enable it by passing `sse: true`.
* When `autoDiscover` is enabled, the event will fan out to all DNS-discovered peers.

> Only events published with SSE enabled will be streamed to subscribers.

# Sagas

Sagas provide a powerful way to orchestrate complex, long-running workflows that involve multiple services. They support **stepwise execution**, **compensation (rollback)**, **reply handling**, and **waiting for external events** (via awakeables).

---

## What is a Saga?

A **Saga** is a workflow pattern that manages distributed transactions and side effects in a coordinated way, including compensations for failures. In Deepkit Restate, you define sagas by extending the `Saga<T>` class and using the `@restate.saga<Api>()` decorator.

---

## Defining a Saga Workflow

Sagas are defined using a fluent builder pattern in the `definition` property:

* `step()`: Defines a new step in the saga.
* `invoke(handler)`: Calls a method in your saga class to perform an action or service call.
* `compensate(handler)`: Defines a rollback method if the step fails or the saga is aborted.
* `onReply<EventType>(handler)`: Registers an event handler for replies to invoked actions.
* `build()`: Finalizes the saga definition.

---

## Awakeables

Awakeables are special constructs to **wait for asynchronous external events**. They provide a promise you can `await` to pause saga execution until an event occurs.

Create awakeables with the saga context inside your saga methods:

```ts
this.confirmTicketAwakeable = this.ctx.awakeable<TicketConfirmed>();
```

---

## Using the Saga Context

The `RestateSagaContext` (`this.ctx`) provides utilities like:

* `awakeable<T>()`: Creates an awakeable to wait for events.
* `set<T>(key, value)`: Persist state data during saga execution.
* `get<T>(key)`: Retrieve persisted state.

---

## Calling Other Services

All service calls inside invocation handlers automatically use the underlying `client.call`. This means:

* You **do not need to manually call `client.call`** within your saga handlers.
* Only **service calls** are supported currently (no direct calls to objects).
* The framework handles communication and reply handling.

---

## Example: Simplified CreateOrderSaga

```ts
import { restate, Saga, RestateSagaContext, RestateAwakeable } from 'deepkit-restate';

@restate.saga<CreateOrderSagaApi>()
export class CreateOrderSaga extends Saga<CreateOrderSagaData> {
  confirmTicketAwakeable?: RestateAwakeable<TicketConfirmed>;

  readonly definition = this.step()
    .invoke(this.create)
    .compensate(this.reject)
    .step()
    .invoke(this.createTicket)
    .onReply<TicketCreated>(this.handleTicketCreated)
    .step()
    .invoke(this.waitForTicketConfirmation)
    .build();

  constructor(
    private readonly order: OrderServiceApi,
    private readonly kitchen: KitchenServiceApi,
    private readonly ctx: RestateSagaContext,
  ) {
    super();
  }

  create(data: CreateOrderSagaData) {
    return this.order.create(data.orderId, data.orderDetails);
  }

  reject(data: CreateOrderSagaData) {
    return this.order.reject(data.orderId);
  }

  createTicket(data: CreateOrderSagaData) {
    this.confirmTicketAwakeable = this.ctx.awakeable<TicketConfirmed>();
    return this.kitchen.createTicket(
      data.orderDetails.restaurantId,
      data.orderId,
      data.orderDetails.lineItems,
      this.confirmTicketAwakeable.id,
    );
  }

  handleTicketCreated(data: CreateOrderSagaData, event: TicketCreated) {
    data.ticketId = event.ticketId;
  }

  async waitForTicketConfirmation(data: CreateOrderSagaData) {
    await this.confirmTicketAwakeable!.promise;
  }
}
```

## Starting a Saga and Retrieving Its State

After defining your saga, you typically want to **start** an instance of it and later **query its state** to track progress or outcome.

### Creating a Saga Client

Use the client to create a saga proxy:

```ts
const createOrderSaga = client.saga<CreateOrderSagaApi>();
```

This creates a handle to interact with the saga.

---

### Starting a Saga Instance

To start a saga, call `start` with the saga’s unique ID and initial input data:

```ts
const startStatus = await createOrderSaga.start(orderId, {
  id: orderId,
  orderTotal: 10.5,
  customerId,
});
```

* `orderId` uniquely identifies the saga instance.
* The second argument is the initial data payload to pass to the saga.
* `start` returns the initial status of saga execution.

---

### Querying the Saga State

At any time, you can query the current state of the saga instance by its ID using `state`:

```ts
const state = await createOrderSaga.state(orderId);
```

This returns the persisted saga data reflecting its current progress, e.g., which step it is on, and any state variables updated along the way.

---

### Notes

* The saga `start` call triggers the first step of your saga workflow.
* The saga state reflects all persisted data and progress, useful for monitoring or troubleshooting.
* You can invoke `start` only once per unique saga instance ID.
* Subsequent state changes happen asynchronously as the saga progresses.

### Summary

* Sagas manage multi-step distributed workflows with clear compensation.
* Steps can invoke service calls, wait for replies, or wait for external events.
* Awakeables let you asynchronously wait inside sagas for external confirmations.
* Saga state can be persisted and retrieved with the saga context.
* Invocation handlers automatically handle calling services; no manual client calls needed.
* Currently, only service calls are supported, no direct object calls with keys.
* Compensation methods help rollback on failure or abort scenarios.

