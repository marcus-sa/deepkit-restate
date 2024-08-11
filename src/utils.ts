import { ClassType } from '@deepkit/core';
import { TerminalError } from '@restatedev/restate-sdk';
import {
  bsonBinarySerializer,
  BSONDeserializer,
  BSONSerializer,
  getBSONDeserializer,
  getBSONSerializer,
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
  deserializeRestateHandlerResponse,
  Entities,
  RestateHandlerRequest,
  RestateObject,
  restateObjectType,
  restateSagaType,
  RestateService,
  restateServiceType,
} from './types.js';
import {
  restateObjectDecorator,
  RestateObjectMetadata,
  restateSagaDecorator,
  RestateSagaMetadata,
  restateServiceDecorator,
  RestateServiceMetadata,
} from './decorator.js';

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
          const serializeArgs = getBSONSerializer(
            bsonBinarySerializer,
            argsType,
          );

          const returnType =
            getUnwrappedReflectionFunctionReturnType(reflectionMethod);
          const deserializeReturn = getBSONDeserializer(
            bsonBinarySerializer,
            returnType,
          );

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

export function decodeRestateServiceMethodResponse<T>(
  response: Uint8Array,
  deserialize: BSONDeserializer<T>,
  entities: Entities,
): T {
  const internalResponse = deserializeRestateHandlerResponse(response);
  if (internalResponse.success) {
    return deserialize(internalResponse.data);
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
  return restateServiceDecorator._fetch(classType);
}

export function getRestateObjectMetadata(
  classType: ClassType,
): RestateObjectMetadata | undefined {
  return restateObjectDecorator._fetch(classType);
}

export function getRestateSagaMetadata(
  classType: ClassType,
): RestateSagaMetadata | undefined {
  return restateSagaDecorator._fetch(classType);
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
