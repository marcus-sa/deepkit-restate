import {
  reflect,
  ReflectionFunction,
  ReflectionKind,
  typeOf,
} from '@deepkit/type';

import { RestateKeyedContext, RestateService } from './types';
import {
  createServiceProxy,
  getClassConstructorParameters,
  getReflectionFunctionArgsType,
  getRestateServiceDeps,
  getRestateServiceName,
  getRestateServiceOptions,
  getTypeArgument,
  getUnwrappedReflectionFunctionReturnType,
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

  expect(getClassConstructorParameters(typeOf<Test>())).toMatchObject([
    {
      kind: 18,
      name: 'key',
      type: {
        kind: 5,
      },
    },
  ]);
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

test('getReflectionFunctionArgsType', () => {
  function createUser(username: string, password: string): void {}

  const reflectionFunction = ReflectionFunction.from(createUser);

  expect(getReflectionFunctionArgsType(reflectionFunction)).toMatchObject({
    kind: ReflectionKind.tuple,
    types: [
      {
        kind: ReflectionKind.tupleMember,
        name: 'username',
        type: {
          kind: ReflectionKind.string,
        },
      },
      {
        kind: ReflectionKind.tupleMember,
        name: 'password',
        type: {
          kind: ReflectionKind.string,
        },
      },
    ],
  });
});

test('getUnwrappedReflectionFunctionReturnType', () => {
  async function test(): Promise<void> {}

  const reflectionFunction = ReflectionFunction.from(test);

  expect(
    getUnwrappedReflectionFunctionReturnType(reflectionFunction),
  ).toMatchObject({
    kind: ReflectionKind.void,
  });
});

describe('createServiceProxy', () => {
  test('args', () => {
    class User {
      readonly createdAt: Date = new Date('2024-03-07T11:08:04.590Z');
    }

    interface PaymentServiceInterface {
      send(user: User): Promise<void>;
    }

    type PaymentServiceApi = RestateService<'payment', PaymentServiceInterface>;

    const service = createServiceProxy<PaymentServiceApi>();

    const { args } = service.send(new User());
    expect(args).toMatchInlineSnapshot(`
      [
        {
          "createdAt": "2024-03-07T11:08:04.590Z",
        },
      ]
    `);
  });
});
