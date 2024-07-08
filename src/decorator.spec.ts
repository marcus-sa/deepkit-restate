import assert from 'node:assert';
import { isType } from '@deepkit/type';

import { RestateObject, RestateSaga, RestateService } from './types.js';
import { restate, RestateObjectMetadata, RestateSagaMetadata, RestateServiceMetadata } from './decorator.js';
import { getRestateObjectMetadata, getRestateSagaMetadata, getRestateServiceMetadata } from './utils.js';
import { Saga } from './saga/saga.js';

test('object', () => {
  interface PaymentServiceInterface {
    send(): Promise<void>;
  }

  type PaymentServiceApi = RestateObject<'payment', PaymentServiceInterface>;

  @restate.object<PaymentServiceApi>()
  class PaymentService {}

  const metadata = getRestateObjectMetadata(PaymentService);
  assert(metadata);
  expect(metadata.classType).toBe(PaymentService);
  expect(isType(metadata.type)).toBe(true);
  expect(metadata).toBeInstanceOf(RestateObjectMetadata);
});

test('service', () => {
  interface PaymentServiceInterface {
    send(): Promise<void>;
  }

  type PaymentServiceApi = RestateService<'payment', PaymentServiceInterface>;

  @restate.service<PaymentServiceApi>()
  class PaymentService {}

  const metadata = getRestateServiceMetadata(PaymentService);
  assert(metadata);
  expect(metadata.classType).toBe(PaymentService);
  expect(isType(metadata.type)).toBe(true);
  expect(metadata).toBeInstanceOf(RestateServiceMetadata);
});

test('saga', () => {
  interface TestSagaData {}

  type TestSagaApi = RestateSaga<'create-order', TestSagaData>;

  @restate.saga<TestSagaApi>()
  class CreateOrderSaga extends Saga<TestSagaData> {}

  const metadata = getRestateSagaMetadata(CreateOrderSaga);
  assert(metadata);
  expect(metadata.classType).toBe(CreateOrderSaga);
  expect(isType(metadata.type)).toBe(true);
  expect(metadata).toBeInstanceOf(RestateSagaMetadata);
});

test('method', () => {
  interface PaymentServiceInterface {
    send(): void;
  }

  type PaymentServiceApi = RestateService<'payment', PaymentServiceInterface>;

  @restate.service<PaymentServiceApi>()
  class PaymentService implements PaymentServiceInterface {
    @restate.method()
    send(): void {}
  }

  const metadata = getRestateServiceMetadata(PaymentService);
  const method = metadata?.methods.values().next().value;
  assert(method);
  expect(method.name).toBe('send');
  expect(method.classType).toBe(PaymentService);
});
