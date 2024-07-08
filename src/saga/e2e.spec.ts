import { float, UUID, uuid } from '@deepkit/type';
import { sleep } from '@deepkit/core';
import { createTestingApp } from '@deepkit/framework';

import { Saga } from './saga.js';
import { restate } from '../decorator.js';
import { RestateSaga, RestateService } from '../types.js';
import { RestateModule } from '../restate.module.js';
import { RestateAdminClient } from '../restate-admin-client.js';
import { RestateClient } from '../restate-client.js';

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
    @restate.method()
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

  class OrderRepository {
    save(data: any) {}
  }

  @restate.saga<CreateOrderSagaApi>()
  class CreateOrderSaga extends Saga<CreateOrderSagaData> {
    readonly definition = this.step()
      .invoke(this.create)
      .compensate(this.reject)
      .step()
      .invoke(this.reserveCustomerCredit)
      // .onReply<TerminalError>(this.handleTerminalError)
      .onReply<CustomerNotFound>(this.handleCustomerNotFound)
      .onReply<CustomerCreditLimitExceeded>(
        this.handleCustomerCreditLimitExceeded,
      )
      .step()
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
    imports: [new RestateModule({ port: 9083 })],
    controllers: [CreateOrderSaga, CustomerController],
  });
  void app.startServer();

  const admin = new RestateAdminClient('http://0.0.0.0:9070');
  await admin.deployments.create(`http://host.docker.internal:9083`);

  const client = new RestateClient({ url: 'http://0.0.0.0:8080' });

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

  const state = await createOrderSaga.state(orderId);
  console.log({ state });

  const endStatus = await createOrderSaga.status(orderId);
  console.log({ endStatus });
});
