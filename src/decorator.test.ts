import { expect, test } from 'bun:test';
import assert from 'node:assert';
import { isType } from '@deepkit/type';

import {
  RestateObjectMetadata,
  RestateSagaMetadata,
  RestateServiceMetadata,
  restate,
} from './decorator.js';
import { Saga } from './saga/saga.js';
import { RestateObject, RestateSaga, RestateService } from './types.js';

import {
  getRestateObjectMetadata,
  getRestateSagaMetadata,
  getRestateServiceMetadata,
} from './utils/type.js';

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
  // @ts-ignore
  class CreateOrderSaga extends Saga<TestSagaData> {}

  const metadata = getRestateSagaMetadata(CreateOrderSaga);
  assert(metadata);
  expect(metadata.classType).toBe(CreateOrderSaga);
  expect(isType(metadata.type)).toBe(true);
  expect(metadata).toBeInstanceOf(RestateSagaMetadata);
});

test('handler', () => {
  interface PaymentServiceInterface {
    send(): void;
  }

  type PaymentServiceApi = RestateService<'payment', PaymentServiceInterface>;

  @restate.service<PaymentServiceApi>()
  class PaymentService implements PaymentServiceInterface {
    @restate.handler()
    send(): void {}
  }

  const metadata = getRestateServiceMetadata(PaymentService);
  const method = metadata?.handlers.values().next().value;
  assert(method);
  expect(method.name).toBe('send');
  expect(method.classType).toBe(PaymentService);
});

// describe('kafka', () => {
//   test('invalid handler parameters', () => {
//     class Consumer {
//       readonly id: UUID = uuid();
//     }
//
//     interface IAccountingService {}
//
//     type KafkaConsumerTopic = RestateKafkaTopic<
//       'consumer',
//       [consumer: Consumer]
//     >;
//
//     type AccountingServiceApi = RestateService<
//       'accounting',
//       IAccountingService
//     >;
//
//     expect(() => {
//       @restate.service<AccountingServiceApi>()
//       class AccountingService implements IAccountingService {
//         // FIXME: options and type are somehow required
//         // @ts-ignore
//         @(restate.kafka<KafkaConsumerTopic>().handler())
//         createAccount(consumer: Consumer, name: string): void {}
//       }
//     }).toThrowErrorMatchingInlineSnapshot(
//       `[Error: Handler "createAccount" parameters [consumer: Consumer, name: string] does not match Kafka topic "consumer" arguments [consumer: Consumer]]`,
//     );
//   });
// });
