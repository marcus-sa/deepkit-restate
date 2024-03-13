import { float, UUID, uuid } from '@deepkit/type';

import { Saga } from './saga';
import { restate } from '../decorator';
import {
  RestateSaga,
  RestateSagaContext,
  RestateService,
  RestateServiceMethodRequest,
} from '../types';
import { createTestingApp } from '@deepkit/framework';
import { RestateModule } from '../restate.module';
import { RestateAdminClient } from '../restate-admin-client';
import { RestateClient } from '../restate-client';

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

  type CustomerServiceApi = RestateService<'customer', CustomerService>;

  @restate.service<CustomerServiceApi>()
  class CustomerController implements CustomerService {
    async reserveCredit(
      customerId: string,
      amount: float,
    ): Promise<CustomerCreditReserved> {
      return new CustomerCreditReserved();
    }
  }

  enum OrderRejectionReason {
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
      .onReply<CustomerNotFound>(this.handleCustomerNotFound)
      .onReply<CustomerCreditLimitExceeded>(
        this.handleCustomerCreditLimitExceeded,
      )
      .step()
      .invoke(this.approve)
      .build();

    constructor(
      private readonly customer: CustomerServiceApi,
      private readonly order: OrderRepository,
    ) {
      super();
    }

    async reserveCustomerCredit({
      customerId,
      orderTotal,
    }: CreateOrderSagaData) {
      return this.customer.reserveCredit(customerId, orderTotal);
    }

    handleCustomerNotFound(data: CreateOrderSagaData): void {
      data.rejectionReason = OrderRejectionReason.UNKNOWN_CUSTOMER;
    }

    handleCustomerCreditLimitExceeded(data: CreateOrderSagaData): void {
      data.rejectionReason = OrderRejectionReason.INSUFFICIENT_CREDIT;
    }

    async create(data: CreateOrderSagaData): Promise<void> {}

    async reject(data: CreateOrderSagaData): Promise<void> {}

    async approve(data: CreateOrderSagaData): Promise<void> {}
  }

  const app = createTestingApp({
    imports: [new RestateModule({ port: 9083 })],
    controllers: [CreateOrderSaga, CustomerController],
  });
  void app.startServer();

  const admin = new RestateAdminClient('http://0.0.0.0:9070');
  await admin.deployments.create(`http://host.docker.internal:9083`);

  const client = new RestateClient('http://0.0.0.0:8080');

  const orderId = uuid();
  const customerId = uuid();

  await client.saga<CreateOrderSagaApi>().start(orderId, {
    id: orderId,
    orderTotal: 10.5,
    customerId,
  });
});
