import assert from 'node:assert';
import { ClassType } from '@deepkit/core';
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
  isSameType,
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
  SerializedType,
  deserializeType,
  SerializedTypes,
} from '@deepkit/type';
import {
  RpcRequest,
  RpcResponse,
} from '@restatedev/restate-sdk/dist/generated/proto/dynrpc';

import {
  RestateClientCallOptions,
  RestateKeyedService,
  restateKeyedServiceType,
  RestateRpcRequest,
  RestateRpcResponse,
  restateSagaType,
  RestateService,
  RestateServiceMethodCall,
  restateServiceMethodCallType,
  RestateServiceOptions,
  restateServiceType,
} from './types';
import {
  restateClassDecorator,
  RestateSagaMetadata,
  RestateServiceMetadata,
} from './decorator';

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

export function isRestateServiceMethodCallType(type: Type): boolean {
  return isSameType(type, restateServiceMethodCallType);
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

export function getRestateServiceName(type: Type): string {
  const typeArgument = getTypeArgument(type, 0);
  assertType(typeArgument, ReflectionKind.literal);
  return typeArgument.literal as string;
}

export function getRestateSagaName(type: Type): string {
  assertRestateSagaType(type);
  const typeArgument = getTypeArgument(type, 0);
  assertType(typeArgument, ReflectionKind.literal);
  return typeArgument.literal as string;
}

export function getRestateSagaDataType(type: Type): TypeObjectLiteral {
  assertRestateSagaType(type);

  const typeArgument = getTypeArgument(type, 1);
  assertType(typeArgument, ReflectionKind.objectLiteral);
  return typeArgument;
}

export function getRestateSagaEntities(type: Type): readonly TypeClass[] {
  assertRestateSagaType(type);

  const typeArgument = getTypeArgument(type, 2);
  assertType(typeArgument, ReflectionKind.tuple);

  return typeArgument.types
    .map(type => type.type)
    .filter((type): type is TypeClass => type.kind === ReflectionKind.class);
}

export function getOriginTypeName(type: Type): string {
  return type.originTypes?.[0].typeName!;
}

export function getRestateServiceEntities(type: Type): Set<ClassType> {
  const typeArgument = getTypeArgument(type, 2);
  if (!typeArgument) return new Set();
  assertType(typeArgument, ReflectionKind.tuple);

  return new Set(
    typeArgument.types
      .map(type => type.type)
      .filter((type): type is TypeClass => type.kind === ReflectionKind.class)
      .map(type => type.classType),
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

        return (...args: readonly unknown[]): RestateServiceMethodCall => {
          const data = encodeRpcResponse(serializeArgs(args));
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
    throw new Error('Missing key for keyed service');
  }
  if (key != null && !keyed) {
    throw new Error('Unnecessary key for unkeyed service');
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

export function encodeSuccessResponse(response: Uint8Array) {}

export function encodeErrorResponse() {}

export function encodeRpcResponse(response: Uint8Array): RestateRpcResponse {
  return Array.from(response);
}

export function decodeRpcResponse(response: Uint8Array): Uint8Array {
  return new Uint8Array(RpcResponse.decode(response).response);
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

type InternalResponse =
  | { success: true; data: Uint8Array }
  | { success: false; error: Uint8Array; serializedType: SerializedTypes };

export function handleResponse<T>(
  response: InternalResponse,
  entities: TypeClass[] = [],
): T {
  if (!response.success) {
    deserializeType(response.serializedType);
    throw new Error();
  }
  return response.data;
}
