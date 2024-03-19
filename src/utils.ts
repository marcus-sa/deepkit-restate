import assert from 'node:assert';
import { ClassType } from '@deepkit/core';
import { RpcRequest } from '@restatedev/restate-sdk/dist/generated/proto/dynrpc.js';
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
  deserializeRestateServiceMethodResponse,
  Entities,
  Entity,
  RestateServiceMethodResponse,
  RestateClientCallOptions,
  RestateKeyedService,
  restateKeyedServiceType,
  RestateRpcRequest,
  RestateRpcResponse,
  restateSagaType,
  RestateService,
  RestateServiceMethodRequest,
  RestateServiceOptions,
  restateServiceType,
  serializeRestateServiceMethodResponse,
} from './types.js';
import {
  restateClassDecorator,
  RestateSagaMetadata,
  RestateServiceMetadata,
} from './decorator.js';

export function getRestateServiceDeps(classType: ClassType): readonly Type[] {
  const serviceType = reflect(classType);
  const ctorParameters = getClassConstructorParameters(serviceType);

  return ctorParameters
    .filter(parameter => isRestateServiceType(parameter.type))
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

export function isRestateServiceKeyed(type: Type): boolean {
  return isRestateKeyedServiceType(type);
}

export function isRestateKeyedServiceType(type: Type): boolean {
  if (type.kind === ReflectionKind.class) return false;
  if (
    type.typeName !== restateKeyedServiceType.typeName &&
    type.originTypes?.[0].typeName !== restateKeyedServiceType.typeName
  ) {
    return false;
  }
  return isExtendable(type, restateKeyedServiceType);
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

export function getRestateServiceName(serviceType: Type): string {
  const typeArgument = getTypeArgument(serviceType, 0);
  assertType(typeArgument, ReflectionKind.literal);
  return typeArgument.literal as string;
}

export function getRestateSagaName(sagaType: Type): string {
  const typeArgument = getTypeArgument(sagaType, 0);
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

export function getRestateServiceEntities(serviceType: Type): Entities {
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

export function assertRestateServiceType(type: Type): void {
  assert(isRestateServiceType(type), 'Not a RestateService type');
}

export function assertRestateSagaType(type: Type) {
  assert(isRestateSagaType(type), 'Not a class or an interface');
}

interface ServiceProxyMethod<T> {
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
    ({ parameter }): TypeTupleMember => ({
      ...parameter,
      parent: argsType,
      kind: ReflectionKind.tupleMember,
    }),
  );

  return argsType;
}

export function getUnwrappedReflectionFunctionReturnType(
  reflectionFunction: ReflectionFunction,
): Type {
  return unwrapType(reflectionFunction.getReturnType());
}

export function createServiceProxy<
  T extends
    | RestateService<string, any, any[]>
    | RestateKeyedService<string, any, any[]>,
>(type?: ReceiveType<T>): T {
  type = resolveReceiveType(type);

  const service = getRestateServiceName(type);
  const entities = getRestateServiceEntities(type);
  const keyed = isRestateServiceKeyed(type);

  const serviceType = getTypeArgument(type, 1);

  const reflectionClass = ReflectionClass.from(serviceType);

  const methods: Record<string, ServiceProxyMethod<unknown>> = {};

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

        return (...args: readonly unknown[]): RestateServiceMethodRequest => {
          const data = Array.from(serializeArgs(args));
          return {
            entities,
            service,
            keyed,
            method,
            data,
            deserializeReturn,
          };
        };
      },
    },
  );
}

export function assertArgs(
  { keyed }: RestateServiceOptions,
  { key }: RestateClientCallOptions,
) {
  if (keyed && key == null) {
    throw new TerminalError('Missing key for keyed service');
  }
  if (key != null && !keyed) {
    throw new TerminalError('Unnecessary key for unkeyed service');
  }
}

export function encodeRpcRequest(
  request: RestateRpcRequest,
  key?: string,
): Uint8Array {
  return RpcRequest.encode(
    RpcRequest.create({
      key,
      request,
    }),
  ).finish();
}

export function encodeRpcResponse(
  response: RestateServiceMethodResponse,
): RestateRpcResponse {
  return Array.from(serializeRestateServiceMethodResponse(response));
}

export function decodeRestateServiceMethodResponse<T>(
  response: Uint8Array,
  deserialize: BSONDeserializer<T>,
  entities: Entities,
): T {
  const internalResponse = deserializeRestateServiceMethodResponse(response);
  if (internalResponse.success) {
    return deserialize(internalResponse.data);
  }
  const entity = entities.get(internalResponse.typeName);
  if (!entity) {
    throw new TerminalError('Unknown entity');
  }
  throw entity.deserialize(internalResponse.data);
}

export function getRestateServiceMetadata(
  classType: ClassType,
): RestateServiceMetadata | undefined {
  return restateClassDecorator._fetch(classType)?.service;
}

export function getRestateSagaMetadata(
  classType: ClassType,
): RestateSagaMetadata | undefined {
  return restateClassDecorator._fetch(classType)?.saga;
}
