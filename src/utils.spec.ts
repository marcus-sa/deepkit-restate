import { getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';
import {
  reflect,
  ReflectionFunction,
  ReflectionKind,
  typeOf,
} from '@deepkit/type';

import {
  RestateObject,
  RestateObjectContext,
  RestateService,
} from './types.js';
import {
  assertValidKafkaTopicName,
  makeInterfaceProxy,
  getClassConstructorParameters,
  getReflectionFunctionArgsType,
  getRestateClassDeps,
  getTypeArgument,
  getUnwrappedReflectionFunctionReturnType,
  isRestateServiceType,
} from './utils.js';
import { getRestateClassEntities, getRestateClassName } from './metadata.js';

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

    expect(isRestateServiceType(typeOf<RestateObjectContext>())).toBe(false);
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

  expect(getRestateClassName(type)).toMatchInlineSnapshot(`"test"`);
});

describe('getRestateClassDeps', () => {
  test('service', () => {
    interface PaymentServiceInterface {
      send(): Promise<void>;
    }

    type PaymentServiceApi = RestateService<'payment', PaymentServiceInterface>;

    class UserService {}

    class TestService {
      constructor(payment: PaymentServiceApi, user: UserService) {}
    }

    const deps = getRestateClassDeps(TestService);
    expect(deps).toHaveLength(1);
  });

  test('object', () => {
    interface PaymentServiceInterface {
      send(): Promise<void>;
    }

    type PaymentServiceApi = RestateObject<'payment', PaymentServiceInterface>;

    class UserService {}

    class TestService {
      constructor(payment: PaymentServiceApi, user: UserService) {}
    }

    const deps = getRestateClassDeps(TestService);
    expect(deps).toHaveLength(1);
  });
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

test('getReflectionFunctionArgsType 2', () => {
  class User {}

  function create(user: User): void {}

  const reflectionFunction = ReflectionFunction.from(create);

  const argsType = getReflectionFunctionArgsType(reflectionFunction);

  expect(argsType).toMatchObject({
    kind: ReflectionKind.tuple,
    types: [
      {
        kind: ReflectionKind.tupleMember,
        name: 'user',
        type: {
          kind: ReflectionKind.class,
          classType: User,
        },
      },
    ],
  });

  const serialize = getBSONSerializer(undefined, argsType);
  const deserialize = getBSONDeserializer(undefined, argsType);

  const serialized = serialize([new User()]);
  const deserialized = deserialize(serialized) as readonly unknown[];
  expect(deserialized[0]).toBeInstanceOf(User);
});

test('getReflectionFunctionArgsType 3', () => {
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

describe('createRestateProxy', () => {
  class User {
    readonly createdAt: Date = new Date('2024-03-07T11:08:04.590Z');
  }

  interface PaymentServiceInterface {
    send(user: User): Promise<void>;
  }

  type PaymentServiceApi = RestateObject<'payment', PaymentServiceInterface>;

  const service = makeInterfaceProxy<PaymentServiceApi>();

  test('method', () => {
    const { method } = service.send(new User());
    expect(method).toMatchInlineSnapshot(`"send"`);
  });

  test('data', () => {
    const { data } = service.send(new User());
    expect(data).toMatchInlineSnapshot(`
      {
        "data": [
          32,
          0,
          0,
          0,
          3,
          48,
          0,
          24,
          0,
          0,
          0,
          9,
          99,
          114,
          101,
          97,
          116,
          101,
          100,
          65,
          116,
          0,
          110,
          80,
          153,
          24,
          142,
          1,
          0,
          0,
          0,
          0,
        ],
        "type": "Buffer",
      }
    `);
  });
});

describe('assertValidKafkaTopicName', () => {
  test('valid', () => {
    assertValidKafkaTopicName('consumer');
  });

  test('invalid', () => {
    expect(() =>
      assertValidKafkaTopicName('restate/consumer'),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid topic name validation pattern ^[a-zA-Z0-9._-]+$ failed for restate/consumer]`,
    );
  });
});
