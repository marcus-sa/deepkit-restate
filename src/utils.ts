import assert from 'node:assert';
import { ClassType } from '@deepkit/core';
import {
  assertType,
  isExtendable,
  ReceiveType,
  reflect,
  ReflectionClass,
  ReflectionKind,
  resolveReceiveType,
  serializeFunction,
  Type,
  TypeLiteral,
  TypeParameter,
  TypePropertySignature,
  TypeTuple,
  TypeTupleMember,
  ReflectionFunction,
  SerializeFunction,
  deserializeFunction,
  serializer,
} from '@deepkit/type';

import {
  RestateClientCallOptions,
  RestateService,
  RestateServiceMethodCall,
  RestateServiceOptions,
  restateServiceType,
} from './types';

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
  assertRestateServiceType(type);

  const firstTypeArgument = getTypeArgument(type, 0);
  assertType(firstTypeArgument, ReflectionKind.literal);

  return firstTypeArgument.literal as string;
}

export function assertRestateServiceType(type: Type): void {
  assert(isRestateServiceType(type), 'Not a RestateService type');
}

export function getRestateServiceOptions(type: Type): RestateServiceOptions {
  assertRestateServiceType(type);

  const thirdTypeArgument = getTypeArgument(type, 2);
  if (!thirdTypeArgument) return {};
  assertType(thirdTypeArgument, ReflectionKind.objectLiteral);

  return thirdTypeArgument.types
    .filter(
      (type): type is TypePropertySignature =>
        type.kind === ReflectionKind.propertySignature,
    )
    .reduce(
      (options, type) => ({
        ...options,
        [type.name]: (type.type as TypeLiteral).literal,
      }),
      {} as RestateServiceOptions,
    );
}

interface ServiceProxyMethod {
  readonly serializeArgs: SerializeFunction;
  readonly deserializeReturn: SerializeFunction;
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

export function createServiceProxy<T extends RestateService<string, any>>(
  type?: ReceiveType<T>,
): T {
  type = resolveReceiveType(type);

  const service = getRestateServiceName(type);
  const options = getRestateServiceOptions(type);

  const serviceType = getTypeArgument(type, 1);
  const reflectionClass = ReflectionClass.from(serviceType);

  const methods: Record<string, ServiceProxyMethod> = {};

  return new Proxy(
    {},
    {
      get(target: any, method: string) {
        if (!methods[method]) {
          const reflectionMethod = reflectionClass.getMethod(method);

          const argsType = getReflectionFunctionArgsType(reflectionMethod);
          const serializeArgs = serializeFunction(
            serializer,
            undefined,
            argsType,
          );

          const returnType =
            getUnwrappedReflectionFunctionReturnType(reflectionMethod);
          const deserializeReturn = deserializeFunction(
            serializer,
            undefined,
            returnType,
          );

          methods[method] = { serializeArgs, deserializeReturn };
        }
        const { serializeArgs, deserializeReturn } = methods[method];

        return (..._args: readonly unknown[]): RestateServiceMethodCall => {
          const args = serializeArgs(_args);
          return <RestateServiceMethodCall>{
            options,
            service,
            method,
            args,
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
