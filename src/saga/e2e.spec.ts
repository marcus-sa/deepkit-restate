import { float } from '@deepkit/type';

import { Saga } from './saga';
import { restate } from '../decorator';
import { RestateSaga, RestateSagaContext, RestateService } from '../types';

test('e2e', () => {
  class CustomerNotFound {}

  class CustomerCreditLimitExceeded {}

  class CustomerCreditReserved {}

  interface CustomerService {
    reserveCredit(id: string, amount: float): Promise<CustomerCreditReserved>;
  }

  type CustomerServiceApi = RestateService<'customer', CustomerService>;

  enum OrderRejectionReason {
    UNKNOWN_CUSTOMER = 'UNKNOWN_CUSTOMER',
    INSUFFICIENT_CREDIT = 'INSUFFICIENT_CREDIT',
  }

  interface CreateOrderSagaData {
    id: string;
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
      ctx: RestateSagaContext,
    ) {
      super(ctx);
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

    async create(data: CreateOrderSagaData) {}

    async reject(data: CreateOrderSagaData) {}

    async approve(data: CreateOrderSagaData) {}
  }
});
