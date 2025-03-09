import {
  BSONDeserializer,
  BSONSerializer,
  getBSONSerializer,
} from '@deepkit/bson';
import { ClassType } from '@deepkit/core';
import { FactoryProvider } from '@deepkit/injector';
import {
  ReceiveType,
  ReflectionClass,
  ReflectionFunction,
  ReflectionKind,
  Type,
  TypeClass,
  TypeObjectLiteral,
  TypeParameter,
  TypeTuple,
  TypeTupleMember,
  assertType,
  isExtendable,
  reflect,
  resolveReceiveType,
  typeSettings,
} from '@deepkit/type';

import {
  RestateObjectMetadata,
  RestateSagaMetadata,
  RestateServiceMetadata,
  restateObjectDecorator,
  restateSagaDecorator,
  restateServiceDecorator,
} from '../decorator.js';
import { getResponseDataDeserializer } from '../serde.js';
import {
  Entities,
  RestateHandlerRequest,
  RestateObject,
  RestateService,
  restateObjectType,
  restateSagaType,
  restateServiceType,
} from '../types.js';

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

  const ctor = type.types.find(
    type => type.kind === ReflectionKind.method && type.name === 'constructor',
  );

  return ctor?.kind === ReflectionKind.method ? ctor.parameters : [];
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

export function getRestateClassName(serviceType: Type): string {
  const typeArgument = getTypeArgument(serviceType, 0);
  assertType(typeArgument, ReflectionKind.literal);
  return typeArgument.literal as string;
}

export function getSagaDataType(sagaType: Type): TypeObjectLiteral | TypeClass {
  const typeArgument = getTypeArgument(sagaType, 1);
  if (
    typeArgument?.kind !== ReflectionKind.objectLiteral &&
    typeArgument?.kind !== ReflectionKind.class
  ) {
    throw new Error('Invalid saga data type');
  }
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
      .map(type => [type.typeName!, type.classType]),
  );
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

export function getRestateSagaMetadata<T>(
  classType: ClassType,
): RestateSagaMetadata<T> | undefined {
  const metadata = restateSagaDecorator._fetch(classType);
  return metadata?.name ? (metadata as RestateSagaMetadata<T>) : undefined;
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
          const deserializeReturn = getResponseDataDeserializer(returnType);

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

export function getRegisteredEntity(className: string): ClassType | undefined {
  return Object.values(typeSettings.registeredEntities).find(
    classType => classType.name === className,
  );
}

export function assertValidKafkaTopicName(topicName: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(topicName)) {
    throw new Error(
      `Invalid topic name validation pattern ^[a-zA-Z0-9._-]+$ failed for ${topicName}`,
    );
  }
}
