import { ClassType, sleep } from '@deepkit/core';
import { CombineablePromise, TerminalError } from '@restatedev/restate-sdk';
import { FactoryProvider } from '@deepkit/injector';
import {
  BSONDeserializer,
  BSONSerializer,
  deserializeBSON,
  getBSONSerializer,
  serializeBSON,
} from '@deepkit/bson';
import {
  assertType,
  isExtendable,
  ReceiveType,
  reflect,
  ReflectionClass,
  ReflectionFunction,
  ReflectionKind,
  resolveReceiveType,
  Type,
  TypeClass,
  TypeObjectLiteral,
  TypeParameter,
  typeSettings,
  TypeTuple,
  TypeTupleMember,
} from '@deepkit/type';

import { getRestateClassEntities, getRestateClassName } from './metadata.js';
import {
  Entities,
  RestateHandlerRequest,
  RestateHandlerResponse,
  RestateObject,
  restateObjectType,
  restateSagaType,
  RestateService,
  restateServiceType,
} from './types.js';
import {
  deserializeRestateHandlerResponse,
  getReturnValueDeserializer,
} from './serializer.js';

export function getRestateClassDeps(classType: ClassType): readonly Type[] {
  const serviceType = reflect(classType);
  const ctorParameters = getClassConstructorParameters(serviceType);

  return ctorParameters
    .filter(
      parameter =>
        isRestateServiceType(parameter.type) ||
        isRestateObjectType(parameter.type),
    )
    .map(parameter => parameter.type);
}

export function getClassConstructorParameters(
  type: Type,
): readonly TypeParameter[] {
  assertType(type, ReflectionKind.class);

  const constructor = type.types.find(
    type => type.kind === ReflectionKind.method && type.name === 'constructor',
  );

  return constructor?.kind === ReflectionKind.method
    ? constructor.parameters
    : [];
}

export function isRestateServiceType(type: Type): boolean {
  if (type.kind === ReflectionKind.class) return false;
  if (
    type.typeName !== restateServiceType.typeName &&
    type.originTypes?.[0].typeName !== restateServiceType.typeName
  ) {
    return false;
  }
  return isExtendable(type, restateServiceType);
}

export function isRestateObjectType(type: Type): boolean {
  if (type.kind === ReflectionKind.class) return false;
  if (
    type.typeName !== restateObjectType.typeName &&
    type.originTypes?.[0].typeName !== restateObjectType.typeName
  ) {
    return false;
  }
  return isExtendable(type, restateObjectType);
}

export function isRestateSagaType(
  type: Type,
): type is TypeObjectLiteral | TypeClass {
  if (type.kind === ReflectionKind.class) return false;
  if (
    type.typeName !== restateSagaType.typeName &&
    type.originTypes?.[0].typeName !== restateSagaType.typeName
  ) {
    return false;
  }
  return isExtendable(type, restateSagaType);
}

export function unwrapType(type: Type): Type {
  switch (type.kind) {
    case ReflectionKind.promise:
      return type.type;

    default:
      return type;
  }
}

export function getTypeArgument(type: Type, index: number): Type | undefined {
  return (
    type.typeArguments?.[index] || type.originTypes?.[0].typeArguments?.[index]
  );
}

interface ClassProxyMethod<T> {
  readonly serializeArgs: BSONSerializer;
  readonly deserializeReturn: BSONDeserializer<T>;
}

export function getReflectionFunctionArgsType(
  reflectionFunction: ReflectionFunction,
): TypeTuple {
  const argsType: TypeTuple = {
    kind: ReflectionKind.tuple,
    types: [],
  };

  argsType.types = reflectionFunction.parameters.map(
    ({ parameter }) =>
      ({
        ...parameter,
        parent: argsType,
        kind: ReflectionKind.tupleMember,
      }) as TypeTupleMember,
  );

  return argsType;
}

export function getUnwrappedReflectionFunctionReturnType(
  reflectionFunction: ReflectionFunction,
): Type {
  return unwrapType(reflectionFunction.getReturnType());
}

export function createClassProxy<
  T extends
    | RestateService<string, any, any[]>
    | RestateObject<string, any, any[]>,
>(type?: ReceiveType<T>): T {
  type = resolveReceiveType(type);

  const service = getRestateClassName(type);
  const entities = getRestateClassEntities(type);

  const classType = getTypeArgument(type, 1);

  const reflectionClass = ReflectionClass.from(classType);

  const methods: Record<string, ClassProxyMethod<unknown>> = {};

  return new Proxy(
    {},
    {
      get(target: any, method: string) {
        if (!methods[method]) {
          const reflectionMethod = reflectionClass.getMethod(method);

          const argsType = getReflectionFunctionArgsType(reflectionMethod);
          const serializeArgs = getBSONSerializer(undefined, argsType);

          const returnType =
            getUnwrappedReflectionFunctionReturnType(reflectionMethod);
          const deserializeReturn = getReturnValueDeserializer(returnType);

          methods[method] = { serializeArgs, deserializeReturn };
        }
        const { serializeArgs, deserializeReturn } = methods[method];

        return (...args: readonly unknown[]): RestateHandlerRequest => {
          const data = serializeArgs(args);
          return {
            entities,
            service,
            method,
            data,
            deserializeReturn,
          };
        };
      },
    },
  );
}

// TODO: wrap client send/rpc calls with ctx.run
// export function provideRestateServiceProxy<T extends RestateService<string, any, any[]>>(type?: ReceiveType<T>): FactoryProvider<T> {
//   type = resolveReceiveType(type);
//
//   const classType = getTypeArgument(type, 1);
//   const reflectionClass = ReflectionClass.from(classType);
//
//   const proxy = createClassProxy<T>(type);
//
//   return {
//     provide: type,
//     useFactory: (contextStorage: RestateContextStorage) => {
//       return new Proxy(proxy, {
//         get(target: T, method: string) {
//           return async (...args: readonly any[]) => {
//             const ctx = contextStorage.getStore()!;
//             return target[method].apply(args);
//           }
//         }
//       });
//     },
//   };
// }

export function provideRestateServiceProxy<
  T extends RestateService<string, any, any[]>,
>(type?: ReceiveType<T>): FactoryProvider<T> {
  type = resolveReceiveType(type);
  return {
    provide: type,
    useFactory: () => createClassProxy<T>(type),
  };
}

export function provideRestateObjectProxy<
  T extends RestateObject<string, any, any[]>,
>(type?: ReceiveType<T>): FactoryProvider<T> {
  type = resolveReceiveType(type);
  return {
    provide: type,
    useFactory: () => createClassProxy<T>(type),
  };
}

export function decodeRestateServiceMethodResponse<T>(
  response: Uint8Array,
  deserialize: BSONDeserializer<T>,
  entities: Entities,
): T {
  const internalResponse = deserializeRestateHandlerResponse(response);
  if (internalResponse.success) {
    return internalResponse.data
      ? deserialize(internalResponse.data)
      : (undefined as T);
  }
  if (!internalResponse.typeName) {
    throw new TerminalError('Missing typeName');
  }
  const entity =
    entities.get(internalResponse.typeName) ||
    typeSettings.registeredEntities[internalResponse.typeName];
  if (!entity) {
    // if (internalResponse.typeName === restateTerminalErrorType.typeName) {
    //   throw deserializeRestateTerminalErrorType(internalResponse.data);
    // }
    throw new TerminalError(`Unknown type ${internalResponse.typeName}`, {
      errorCode: 500,
    });
  }
  if (!internalResponse.data) {
    throw new TerminalError(
      `Missing response data for error ${internalResponse.typeName}`,
      {
        errorCode: 500,
      },
    );
  }
  throw deserializeBSON(internalResponse.data, undefined, undefined, entity);
}

export function assertValidKafkaTopicName(topicName: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(topicName)) {
    throw new Error(
      `Invalid topic name validation pattern ^[a-zA-Z0-9._-]+$ failed for ${topicName}`,
    );
  }
}

export interface InvokeOneWayOptions {
  readonly service: string;
  readonly method: string;
  readonly data: Uint8Array;
  readonly delay?: number;
  readonly key?: string;
}

export function invokeOneWay<T>(
  ctx: any,
  { service, method, data, delay, key }: InvokeOneWayOptions,
): CombineablePromise<T> {
  return ctx
    .invokeOneWay(service, method, data, undefined, delay, key)
    .catch((e: Error) => {
      ctx.stateMachine.handleDanglingPromiseError(e);
    });
}

export function success<T>(
  reply?: T,
  type?: ReceiveType<T>,
): RestateHandlerResponse {
  if (reply) {
    type = resolveReceiveType(type);
    return {
      success: true,
      data: serializeBSON(reply, undefined, type),
      typeName: type.typeName,
    };
  }

  return {
    success: true,
    data: new Uint8Array([]),
  };
}

export function failure<T>(
  reply?: T,
  type?: ReceiveType<T>,
): RestateHandlerResponse {
  if (reply) {
    type = resolveReceiveType(type);
    return {
      success: false,
      data: serializeBSON(reply, undefined, type),
      typeName: type.typeName,
    };
  }

  return {
    success: false,
    data: new Uint8Array([]),
  };
}

export function waitUntil(
  predicate: () => boolean,
  timeout: number = 1000,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let wait = true;

    setTimeout(() => {
      wait = false;
      reject(new Error(`Timeout ${timeout}ms exceeded`));
    }, timeout);

    while (wait) {
      if (predicate()) {
        wait = false;
        resolve();
      }
      await sleep(0);
    }
  });
}
