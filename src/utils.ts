import { ClassType } from '@deepkit/core';
import { CombineablePromise, TerminalError } from '@restatedev/restate-sdk';
import { FactoryProvider } from '@deepkit/injector';
import {
  bsonBinarySerializer,
  BSONDeserializer,
  BSONSerializer,
  getBSONDeserializer,
  getBSONSerializer, serializeBSON,
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
  TypeTuple,
  TypeTupleMember,
} from '@deepkit/type';

import {
  restateObjectDecorator,
  RestateObjectMetadata,
  restateSagaDecorator,
  RestateSagaMetadata,
  restateServiceDecorator,
  RestateServiceMetadata,
} from './decorator.js';
import {
  deserializeRestateHandlerResponse,
  Entities,
  RestateHandlerRequest,
  RestateObject,
  restateObjectType,
  restateSagaType,
  RestateService,
  restateServiceType, serializeRestateHandlerResponse,
} from './types.js';

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

export function getRestateClassName(serviceType: Type): string {
  const typeArgument = getTypeArgument(serviceType, 0);
  assertType(typeArgument, ReflectionKind.literal);
  return typeArgument.literal as string;
}

export function getSagaDataDeserializer<T>(
  sagaType: Type,
): BSONDeserializer<T> {
  const dataType = getSagaDataType(sagaType);
  return getBSONDeserializer(bsonBinarySerializer, dataType);
}

export function getSagaDataSerializer(sagaType: Type): BSONSerializer {
  const dataType = getSagaDataType(sagaType);
  return getBSONSerializer(bsonBinarySerializer, dataType);
}

export function getSagaDataType(sagaType: Type): TypeObjectLiteral {
  const typeArgument = getTypeArgument(sagaType, 1);
  assertType(typeArgument, ReflectionKind.objectLiteral);
  return typeArgument;
}

export function getRestateClassEntities(serviceType: Type): Entities {
  const typeArgument = getTypeArgument(serviceType, 2);
  if (!typeArgument) return new Map();
  assertType(typeArgument, ReflectionKind.tuple);

  return new Map(
    typeArgument.types
      .map(type => type.type)
      .filter((type): type is TypeClass => type.kind === ReflectionKind.class)
      .map(type => {
        const deserialize = getBSONDeserializer(bsonBinarySerializer, type);
        const serialize = getBSONSerializer(bsonBinarySerializer, type);
        return [
          type.typeName!,
          { deserialize, serialize, classType: type.classType },
        ];
      }),
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
          const deserializeReturn = getBSONDeserializer(undefined, returnType);

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
    return deserialize(internalResponse.data);
  }
  if (!internalResponse.typeName) {
    throw new TerminalError('Missing typeName');
  }
  const entity = entities.get(internalResponse.typeName);
  if (!entity) {
    // if (internalResponse.typeName === restateTerminalErrorType.typeName) {
    //   throw deserializeRestateTerminalErrorType(internalResponse.data);
    // }
    throw new TerminalError('Unknown entity');
  }
  throw entity.deserialize(internalResponse.data);
}

export function getRestateServiceMetadata(
  classType: ClassType,
): RestateServiceMetadata | undefined {
  const metadata = restateServiceDecorator._fetch(classType);
  return metadata?.name ? metadata : undefined;
}

export function getRestateObjectMetadata(
  classType: ClassType,
): RestateObjectMetadata | undefined {
  const metadata = restateObjectDecorator._fetch(classType);
  return metadata?.name ? metadata : undefined;
}

export function getRestateSagaMetadata(
  classType: ClassType,
): RestateSagaMetadata | undefined {
  const metadata = restateSagaDecorator._fetch(classType);
  return metadata?.name ? metadata : undefined;
}

export function assertValidKafkaTopicName(topicName: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(topicName)) {
    throw new Error(
      `Invalid topic name validation pattern ^[a-zA-Z0-9._-]+$ failed for ${topicName}`,
    );
  }
}

export function getRestateKafkaTopicSource(type: Type): string {
  const typeArgument = getTypeArgument(type, 0);
  assertType(typeArgument, ReflectionKind.literal);
  if (!(typeof typeArgument.literal === 'string')) {
    throw new Error('Value must be a string');
  }
  return typeArgument.literal;
}

export function getRestateKafkaTopicArgsType(type: Type): TypeTuple {
  const typeArgument = getTypeArgument(type, 1);
  assertType(typeArgument, ReflectionKind.tuple);
  return typeArgument;
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
    .invokeOneWay(service, method, data, delay, key)
    .catch((e: Error) => {
      ctx.stateMachine.handleDanglingPromiseError(e);
    });
}

export function success<T>(reply?: T, type?: ReceiveType<T>) {
  if (reply) {
    type = resolveReceiveType(type);
    return serializeRestateHandlerResponse({
      success: true,
      data: serializeBSON(reply, undefined, type),
      typeName: type.typeName,
    });
  }

  return serializeRestateHandlerResponse({
    success: true,
    data: new Uint8Array([]),
  });
}

export function failure<T>(reply?: T, type?: ReceiveType<T>) {
  if (reply) {
    type = resolveReceiveType(type);
    return serializeRestateHandlerResponse({
      success: false,
      data: serializeBSON(reply, undefined, type),
      typeName: type.typeName,
    });
  }

  return serializeRestateHandlerResponse({
    success: false,
    data: new Uint8Array([]),
  });
}
