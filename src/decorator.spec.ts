import assert from 'node:assert';

import { RestateService } from './types';
import { restate, restateClassDecorator } from './decorator';
import { isType } from '@deepkit/type';

test('service', () => {
  interface PaymentServiceInterface {
    send(): Promise<void>;
  }

  type PaymentServiceApi = RestateService<
    'payment',
    PaymentServiceInterface,
    { keyed: true }
  >;

  @restate.service<PaymentServiceApi>()
  class PaymentService {}

  const metadata = restateClassDecorator._fetch(PaymentService);
  assert(metadata);

  expect(metadata.classType).toBe(PaymentService);
  expect(isType(metadata.type)).toBe(true);
  expect(metadata.keyed).toBe(true);
});

test('method', () => {});
