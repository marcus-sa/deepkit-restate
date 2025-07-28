import { float, UUID, uuid } from '@deepkit/type';
import { sleep } from '@deepkit/core';
import { createTestingApp } from '@deepkit/framework';
import { Mock, vi, test, expect } from 'vitest';

import { restate } from '../decorator.js';
import {
  RestateRunAction,
  RestateSaga,
  RestateSagaContext,
  RestateService,
} from '../types.js';
import { RestateModule } from '../restate.module.js';
import { RestateIngressClient } from '../restate-ingress-client.js';
import { Saga } from './saga.js';
import { SagaManager } from './saga-manager.js';
import { getRestateSagaMetadata } from '../metadata.js';
import { success } from '../utils.js';

interface RestateTestContext extends RestateSagaContext {
  invoke: Mock<(...args: any[]) => any>;
  run: (action: RestateRunAction<any>) => Promise<any>;
}

function createTestContext(): RestateTestContext {
  const store = new Map();

  return {
    store,
    invoke: vi.fn(),
    set: async (key, value) => store.set(key, value),
    get: key => store.get(key),
    run: async (action: RestateRunAction<any>) => action(),
  } as RestateTestContext;
}

test('e2e', async () => {
  class CustomerNotFound {}

  class CustomerCreditLimitExceeded {}

  class CustomerCreditReserved {}

  interface CustomerService {
    reserveCredit(
      customerId: string,
      amount: float,
    ): Promise<CustomerCreditReserved>;
  }

  type CustomerServiceApi = RestateService<
    'customer',
    CustomerService,
    [CustomerCreditLimitExceeded, CustomerNotFound]
  >;

  @restate.service<CustomerServiceApi>()
  class CustomerController implements CustomerService {
    @restate.handler()
    async reserveCredit(
      customerId: string,
      amount: float,
    ): Promise<CustomerCreditReserved> {
      // throw new CustomerNotFound();
      return new CustomerCreditReserved();
    }
  }

  enum OrderRejectionReason {
    // TERMINAL_ERROR = 'TERMINAL_ERROR',
    UNKNOWN_CUSTOMER = 'UNKNOWN_CUSTOMER',
    INSUFFICIENT_CREDIT = 'INSUFFICIENT_CREDIT',
  }

  interface CreateOrderSagaData {
    id: UUID;
    customerId: string;
    orderTotal: float;
    rejectionReason?: OrderRejectionReason;
  }

  type CreateOrderSagaApi = RestateSaga<'create-order', CreateOrderSagaData>;

  @restate.saga<CreateOrderSagaApi>()
  class CreateOrderSaga extends Saga<CreateOrderSagaData> {
    readonly definition = this.step()
      .compensate(this.reject)
      .step()
      .invoke(this.create)
      // .awakeable('test')
      .step()
      .invoke(this.reserveCustomerCredit)
      // .onReply<TerminalError>(this.handleTerminalError)
      .onReply<CustomerNotFound>(this.handleCustomerNotFound)
      .onReply<CustomerCreditLimitExceeded>(
        this.handleCustomerCreditLimitExceeded,
      )
      .step()
      // .waitForAwakeable('test')
      // .step()
      .invoke(this.approve)
      .build();

    constructor(private readonly customer: CustomerServiceApi) {
      super();
    }

    reserveCustomerCredit({ customerId, orderTotal }: CreateOrderSagaData) {
      console.log('reserveCustomerCredit');
      return this.customer.reserveCredit(customerId, orderTotal);
    }

    // handleTerminalError(data: CreateOrderSagaData) {
    //   console.log('handleTerminalError');
    //   data.rejectionReason = OrderRejectionReason.TERMINAL_ERROR;
    // }

    handleCustomerNotFound(data: CreateOrderSagaData): void {
      console.log('handleCustomerNotFound');
      data.rejectionReason = OrderRejectionReason.UNKNOWN_CUSTOMER;
    }

    handleCustomerCreditLimitExceeded(data: CreateOrderSagaData): void {
      console.log('handleCustomerCreditLimitExceeded');
      data.rejectionReason = OrderRejectionReason.INSUFFICIENT_CREDIT;
    }

    async create(data: CreateOrderSagaData): Promise<void> {
      console.log('create');
    }

    async reject(data: CreateOrderSagaData): Promise<void> {
      console.log('reject');
    }

    async approve(data: CreateOrderSagaData): Promise<void> {
      console.log('approve');
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
    controllers: [CreateOrderSaga],
  });
  await app.startServer();

  const client = app.app.getInjectorContext().get<RestateIngressClient>();

  const orderId = uuid();
  const customerId = uuid();

  const createOrderSaga = client.saga<CreateOrderSagaApi>();

  const startStatus = await createOrderSaga.start(orderId, {
    id: orderId,
    orderTotal: 10.5,
    customerId,
  });
  console.log({ startStatus });

  await sleep(5);

  // const response = await fetch(`http://0.0.0.0:8080/restate/workflow/create-order/${orderId}/output`);
  // console.log(await response.text());

  const state = await createOrderSaga.state(orderId);
  console.log({ state });

  // const endStatus = await createOrderSaga.status(orderId);
  // console.log({ endStatus });
});

test('compensation', async () => {
  interface WithCompensationSagaData {}

  type WithCompensationSagaApi = RestateSaga<
    'WithCompensation',
    WithCompensationSagaData
  >;

  const compensate1 = vi.fn();

  @restate.saga<WithCompensationSagaApi>()
  class WithCompensationSaga extends Saga<WithCompensationSagaData> {
    readonly definition = this.step()
      .invoke(this.invoke1)
      .compensate(compensate1)
      .step()
      .invoke(this.invoke2)
      .build();

    invoke1() {}

    invoke2() {
      throw new Error();
    }
  }

  const saga = new WithCompensationSaga();

  const metadata = getRestateSagaMetadata(WithCompensationSaga)!;

  const ctx = createTestContext();

  const manager = new SagaManager(ctx, saga, metadata);

  await manager.start({});

  expect(compensate1).toHaveBeenCalled();
});

test('compensation 2', async () => {
  interface WithCompensationSagaData {}

  type WithCompensationSagaApi = RestateSaga<
    'WithCompensation',
    WithCompensationSagaData
  >;

  const compensate1 = vi.fn();

  @restate.saga<WithCompensationSagaApi>()
  class WithCompensationSaga extends Saga<WithCompensationSagaData> {
    readonly definition = this.step()
      .invoke(this.invoke1)
      .compensate(compensate1)
      .build();

    invoke1() {
      throw new Error();
    }
  }

  const saga = new WithCompensationSaga();

  const metadata = getRestateSagaMetadata(WithCompensationSaga)!;

  const ctx = createTestContext();

  const manager = new SagaManager(ctx, saga, metadata);

  await manager.start({});

  expect(compensate1).not.toHaveBeenCalled();
});

test('reply', async () => {
  interface WithReplySagaData {}

  type WithReplySagaApi = RestateSaga<'WithReply', WithReplySagaData>;

  const invoke = vi.fn();

  const reply1 = vi.fn();

  class Reply {
    constructor(public readonly id: UUID) {}
  }

  @restate.saga<WithReplySagaApi>()
  class WithReplySaga extends Saga<WithReplySagaData> {
    readonly definition = this.step()
      .invoke(invoke)
      .onReply<Reply>(reply1)
      .build();
  }

  const saga = new WithReplySaga();

  const metadata = getRestateSagaMetadata(WithReplySaga)!;

  const ctx = createTestContext();

  const manager = new SagaManager(ctx, saga, metadata);

  ctx.invoke.mockImplementationOnce(() => success<Reply>(new Reply(uuid())));

  expect(reply1).toHaveBeenCalled();
});
