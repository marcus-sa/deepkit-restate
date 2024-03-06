import { assertType, reflect, ReflectionKind, typeOf } from '@deepkit/type';

import { RestateKeyedContext, RestateService } from './types';
import {
  createServiceProxy,
  getClassConstructorParameters,
  getRestateServiceDeps,
  getRestateServiceName,
  getRestateServiceOptions,
  getTypeArgument,
  isRestateServiceType,
} from './utils';
import { describe } from 'vitest';

describe('isRestateServiceType', () => {
  test('returns true', () => {
    interface UserServiceInterface {
      create(): Promise<void>;
    }

    type UserServiceApi = RestateService<'user', UserServiceInterface>;

    expect(isRestateServiceType(typeOf<UserServiceApi>())).toBe(true);
  });

  test('returns false', () => {
    class TestService {}

    expect(isRestateServiceType(reflect(TestService))).toBe(false);

    expect(isRestateServiceType(typeOf<RestateKeyedContext>())).toBe(false);
  });
});

test('getClassConstructorParameters', () => {
  class Test {
    constructor(key: string) {}
  }

  expect(getClassConstructorParameters(typeOf<Test>())).toMatchInlineSnapshot(`
    [
      {
        "kind": 18,
        "name": "key",
        "parent": {
          "kind": 16,
          "name": "constructor",
          "parameters": [Circular],
          "parent": {
            "classType": [Function],
            "id": 42,
            "kind": 20,
            "typeArguments": undefined,
            "typeName": "Test",
            "types": [
              [Circular],
            ],
          },
          "return": {
            "kind": 1,
            "parent": [Circular],
          },
          "visibility": 0,
        },
        "type": {
          "kind": 5,
          "parent": [Circular],
        },
      },
    ]
  `);
});

describe('getTypeArgument', () => {
  type Test<T extends string> = T;

  test('inline', () => {
    expect(getTypeArgument(typeOf<Test<'inline'>>(), 0)).toMatchObject({
      kind: 13,
      literal: 'inline',
      typeName: 'Test',
    });
  });

  test('referenced', () => {
    type Referenced = Test<'referenced'>;

    expect(getTypeArgument(typeOf<Referenced>(), 0)).toMatchObject({
      kind: 13,
      literal: 'referenced',
      typeName: 'Test',
    });
  });
});

test('getRestateServiceName', () => {
  const type = typeOf<RestateService<'test', any>>();

  expect(getRestateServiceName(type)).toMatchInlineSnapshot(`"test"`);
});

test('getRestateServiceOptions', () => {
  const type = typeOf<RestateService<'test', any, { keyed: true }>>();

  expect(getRestateServiceOptions(type)).toMatchInlineSnapshot(`
    {
      "keyed": true,
    }
  `);
});

test('createServiceProxy', () => {
  interface PaymentServiceInterface {
    send(id: number): Promise<string>;
  }

  type PaymentServiceApi = RestateService<
    'payment',
    PaymentServiceInterface,
    { keyed: true }
  >;

  const proxy = createServiceProxy<PaymentServiceApi>();

  const result = proxy.send(1);
  expect(result.args).toMatchInlineSnapshot(`
    [
      1,
    ]
  `);
  expect(result.method).toMatchInlineSnapshot(`"send"`);
  expect(result.options).toMatchInlineSnapshot(`
    {
      "keyed": true,
    }
  `);
  expect(result.returnType.kind).toBe(ReflectionKind.string);
});

test('getRestateDependenciesForService', () => {
  interface PaymentServiceInterface {
    send(): Promise<void>;
  }

  type PaymentServiceApi = RestateService<'payment', PaymentServiceInterface>;

  class UserService {}

  class TestService {
    constructor(payment: PaymentServiceApi, user: UserService) {}
  }

  const deps = getRestateServiceDeps(TestService);
  expect(deps).toHaveLength(1);
});
