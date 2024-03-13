import assert from 'node:assert';
import { isType } from '@deepkit/type';

import { RestateKeyedService, RestateSaga, RestateService } from './types';
import { restate } from './decorator';
import { getRestateServiceMetadata } from './utils';
import { Saga } from './saga/saga';

test('service', () => {
  interface PaymentServiceInterface {
    send(): Promise<void>;
  }

  type PaymentServiceApi = RestateKeyedService<
    'payment',
    PaymentServiceInterface
  >;

  @restate.service<PaymentServiceApi>()
  class PaymentService {}

  const metadata = getRestateServiceMetadata(PaymentService);
  assert(metadata);
  expect(metadata.classType).toBe(PaymentService);
  expect(isType(metadata.type)).toBe(true);
  expect(metadata.keyed).toBe(true);
});

test('saga', () => {
  interface TestSagaData {}

  type TestSagaApi = RestateSaga<'create-order', TestSagaData>;

  @restate.saga<TestSagaApi>()
  class CreateOrderSaga extends Saga<TestSagaData> {}
});

test('method', () => {});
