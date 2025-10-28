import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as restate from '@restatedev/restate-sdk';
import { InjectorContext } from '@deepkit/injector';
import { createServiceContext } from './context.js';
import { RestateConfig } from './config.js';

// Mock the restate SDK
import { uuid } from '@deepkit/type';
import { RestatePromise, RunOptions, serde } from '@restatedev/restate-sdk';
import type { Serde } from '@restatedev/restate-sdk-core';
import { RestateIngressClient } from 'deepkit-restate';
import { Mock, vi } from 'vitest';

interface MockRand {
  uuidv4: Mock<() => string>;
  random: Mock<() => number>;
}

interface MockDate {
  now: Mock<() => Promise<Date>>;
  toJSON: Mock<() => Promise<string>>;
}

export interface MockedServiceContext {
  console: Console;
  date: MockDate;
  rand: MockRand;
  workflowClient: Mock;
  workflowSendClient: Mock;
  objectClient: Mock;
  objectSendClient: Mock;
  serviceClient: Mock;
  serviceSendClient: Mock;
  sleep: (ms: number) => Promise<void>;
  run: Mock;
  request: Mock;
  rejectAwakeable: Mock;
  cancel: Mock;
  genericCall: Mock<() => RestatePromise<any>>;
  genericSend: Mock<() => RestatePromise<any>>;
  call: Mock<() => RestatePromise<any>>;
  send: Mock<() => RestatePromise<any>>;
}

export interface MockedObjectContext extends MockedServiceContext {
  key: string;
  set: Mock<(key: string, value: any) => void>;
  clear: Mock<(key: string) => void>;
  clearAll: Mock;
  stateKeys: Mock<() => string[]>;
  get: Mock<(key: string) => Promise<any>>;
}

const jsonSerde = serde.json;

const createMockedRestateClient = () => ({
  send: vi.fn().mockImplementation(async (fn: () => Promise<any>) => ({
    invocationId: uuid(),
  })),
  call: vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn()),
});

export const createMockedIngressClient = (params: {
  services: Record<string, Function>;
}) =>
  ({
    ...createMockedRestateClient(),
    opts: {},
    service: vi.fn().mockImplementation(() => ({
      ...(params.services ?? {}),
    })),
    object: vi.fn().mockImplementation(() => ({})),
    saga: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockImplementation(async () => ({
        invocationId: uuid(),
      })),
      state: vi.fn().mockImplementation(async () => ({})),
    })),
  }) as unknown as RestateIngressClient;

export function createMockedServiceContext(): MockedServiceContext {
  return {
    console: console,
    rand: {
      random: vi.fn().mockImplementation(() => Math.random()),
      uuidv4: vi.fn().mockImplementation(() => uuid()),
    },
    request: vi.fn(),
    rejectAwakeable: vi.fn(),
    cancel: vi.fn(),
    date: {
      now: vi.fn().mockImplementation(async () => new Date()),
      toJSON: vi.fn().mockImplementation(async () => new Date().toJSON()),
    },
    objectClient: vi.fn(),
    objectSendClient: vi.fn(),
    serviceClient: vi.fn(),
    serviceSendClient: vi.fn(),
    workflowClient: vi.fn().mockImplementation(() => {
      return {
        run: vi.fn(),
      };
    }),
    workflowSendClient: vi.fn().mockImplementation(() => {
      return {
        run: vi.fn(),
      };
    }),
    run: vi
      .fn()
      .mockImplementation(
        async (
          name: string,
          fn: () => Promise<any>,
          options?: RunOptions<any>,
        ) => {
          const serde = options?.serde || jsonSerde;
          const result = serde.serialize(await fn());
          return serde.deserialize(result);
        },
      ),
    sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
    genericCall: vi.fn().mockReturnValue([]),
    genericSend: vi.fn(),
    ...createMockedRestateClient(),
  };
}

export const createMockedRestateDatabaseContext = () => ({
  runInTransaction: createMockedServiceContext().run,
});

export function createMockedObjectContext(key: string): MockedObjectContext {
  const state = new Map<string, any>();

  return {
    ...createMockedServiceContext(),
    key,
    stateKeys: vi.fn().mockImplementation(() => Array.from(state.keys())),
    clear: vi.fn().mockImplementation((key: string) => {
      state.delete(key);
    }),
    clearAll: vi.fn().mockImplementation(() => {
      state.clear();
    }),
    set: vi
      .fn()
      .mockImplementation(
        (key: string, value: any, serde: Serde<any> = jsonSerde) => {
          state.set(key, serde.serialize(value));
        },
      ),
    get: vi
      .fn()
      .mockImplementation(
        async (key: string, serde: Serde<any> = jsonSerde) => {
          return state.has(key) ? serde.deserialize(state.get(key)) : null;
        },
      ),
  };
}

describe('context run operation', () => {
  let context: ReturnType<typeof createServiceContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createServiceContext(
      createMockedServiceContext() as any,
      undefined as never,
    );
  });

  describe('primitive types', () => {
    test('boolean', async () => {
      const result = await context.run<boolean>(
        'test-boolean-true',
        () => true,
      );
      expect(result).toBe(true);
    });

    test('number', async () => {
      const result = await context.run<number>(
        'test-number-positive',
        () => 42,
      );
      expect(result).toBe(42);
    });

    test('string', async () => {
      const result = await context.run<string>(
        'test-string-text',
        () => 'hello world',
      );
      expect(result).toBe('hello world');
    });

    test('bigint', async () => {
      const testValue = BigInt('9007199254740991');
      const result = await context.run<bigint>(
        'test-bigint-positive',
        () => testValue,
      );
      expect(result).toBe(testValue);
    });

    test('null', async () => {
      const result = await context.run<null>('test-null', () => null);
      expect(result).toBe(null);
    });
  });

  describe('undefined types', () => {
    test('undefined', async () => {
      const result = await context.run<undefined>(
        'test-undefined',
        () => undefined,
      );
      expect(result).toBe(void 0);
    });

    test('void', async () => {
      const result = await context.run<void>('test-void', () => {});
      expect(result).toBe(void 0);
    });
  });

  describe('union types', () => {
    test('string | number - string value', async () => {
      const result = await context.run<string | number>(
        'test-union-string',
        () => 'hello',
      );
      expect(result).toBe('hello');
    });

    test('string | number - number value', async () => {
      const result = await context.run<string | number>(
        'test-union-number',
        () => 42,
      );
      expect(result).toBe(42);
    });

    test('boolean | null - boolean value', async () => {
      const result = await context.run<boolean | null>(
        'test-union-boolean',
        () => true,
      );
      expect(result).toBe(true);
    });

    test('boolean | null - null value', async () => {
      const result = await context.run<boolean | null>(
        'test-union-null',
        () => null,
      );
      expect(result).toBe(null);
    });

    test('literal union types', async () => {
      const result = await context.run<'success' | 'error' | 'pending'>(
        'test-literal-union',
        () => 'success',
      );
      expect(result).toBe('success');
    });
  });

  describe('object types', () => {
    test('simple object literal', async () => {
      const testObj = { name: 'test', value: 42 };
      const result = await context.run<{ name: string; value: number }>(
        'test-object-literal',
        () => testObj,
      );
      expect(result).toEqual(testObj);
    });

    test('nested object', async () => {
      const testObj = {
        user: {
          id: 1,
          profile: { name: 'John', age: 30 },
        },
      };
      type NestedObj = {
        user: {
          id: number;
          profile: { name: string; age: number };
        };
      };
      const result = await context.run<NestedObj>(
        'test-nested-object',
        () => testObj,
      );
      expect(result).toEqual(testObj);
    });

    test('array of primitives', async () => {
      const testArray = [1, 2, 3, 4, 5];
      const result = await context.run<number[]>(
        'test-number-array',
        () => testArray,
      );
      expect(result).toEqual(testArray);
    });

    test('array of objects', async () => {
      const testArray = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      const result = await context.run<{ id: number; name: string }[]>(
        'test-object-array',
        () => testArray,
      );
      expect(result).toEqual(testArray);
    });

    test('tuple types', async () => {
      const testTuple: [string, number, boolean] = ['hello', 42, true];
      const result = await context.run<[string, number, boolean]>(
        'test-tuple',
        () => testTuple,
      );
      expect(result).toEqual(testTuple);
    });
  });

  describe('interface types', () => {
    interface User {
      id: number;
      name: string;
      email?: string;
    }

    test('interface with required properties', async () => {
      const user: User = { id: 1, name: 'John' };
      const result = await context.run<User>(
        'test-interface-required',
        () => user,
      );
      expect(result).toEqual(user);
    });

    test('interface with optional properties', async () => {
      const user: User = { id: 1, name: 'John', email: 'john@example.com' };
      const result = await context.run<User>(
        'test-interface-optional',
        () => user,
      );
      expect(result).toEqual(user);
    });

    interface GenericContainer<T> {
      data: T;
      metadata: { created: Date; version: number };
    }

    test('generic interface', async () => {
      const container: GenericContainer<string> = {
        data: 'test data',
        metadata: { created: new Date('2024-01-01'), version: 1 },
      };
      const result = await context.run<GenericContainer<string>>(
        'test-generic-interface',
        () => container,
      );
      expect(result).toEqual(container);
    });
  });

  describe('class types', () => {
    class TestUser {
      constructor(
        public id: number,
        public name: string,
        public createdAt: Date = new Date('2024-01-01'),
      ) {}

      getDisplayName(): string {
        return `User: ${this.name}`;
      }
    }

    test('class instance', async () => {
      const user = new TestUser(1, 'John');
      const result = await context.run<TestUser>(
        'test-class-instance',
        () => user,
      );
      expect(result).toEqual(user);
    });

    test('class with complex properties', async () => {
      class ComplexClass {
        constructor(
          public data: { items: string[] },
          public metadata: { tags: string[]; count: number } = {
            tags: [],
            count: 0,
          },
        ) {}
      }

      const instance = new ComplexClass(
        { items: ['a', 'b', 'c'] },
        { tags: ['tag1', 'tag2'], count: 3 },
      );
      const result = await context.run<ComplexClass>(
        'test-complex-class',
        () => instance,
      );
      expect(result).toEqual(instance);
    });
  });

  describe('error handling', () => {
    test('should throw error when unknown type is provided', () => {
      expect(() => {
        context.run<unknown>('test-unknown-type', () => 'test');
      }).toThrow('run type cannot be unknown');
    });

    test('should error when type has not been provided', async () => {
      // When no generic type is provided, TypeScript infers unknown, but at runtime
      // resolveReceiveType(undefined) should handle this case
      expect(() => {
        context.run('test-no-generic', () => 'test');
      }).toThrow(
        'No type information received. Circular import or no runtime type available.',
      );
    });
  });
});
