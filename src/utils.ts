import { ClassType, sleep, toFastProperties } from '@deepkit/core';
import { xxHash32 } from 'js-xxhash';
import {
  BSONDeserializer,
  BSONSerializer,
  getBSONSerializer,
  serializeBSON,
} from '@deepkit/bson';
import {
  assertType,
  cast,
  deserialize,
  getTypeJitContainer,
  isExtendable,
  JSONEntity,
  ReceiveType,
  reflect,
  ReflectionClass,
  ReflectionFunction,
  ReflectionKind,
  resolveReceiveType,
  serialize,
  SerializedTypes,
  serializeType,
  Type,
  TypeClass,
  TypeObjectLiteral,
  NamingStrategy,
  SerializationOptions,
  serializer,
  Serializer,
  TypeParameter,
  typeSettings,
  TypeTuple,
  JSONSingle,
  TypeTupleMember,
} from '@deepkit/type';

import { getRestateClassName } from './metadata.js';
import {
  RestateHandlerRequest,
  RestateHandlerResponse,
  RestateObject,
  restateObjectType,
  restateSagaType,
  RestateService,
  restateServiceType,
} from './types.js';
import { MissingTypeName } from './event/errors.js';

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

    case ReflectionKind.void:
      return type;

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
  readonly serializeArgs: JSONSerializer<unknown>;
  readonly argsType: Type;
  readonly returnType: Type;
  readonly deserializeReturn: JSONDeserializer<T>;
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

export function makeInterfaceProxy<
  T extends RestateService<string, any> | RestateObject<string, any>,
>(type?: ReceiveType<T>): T {
  type = resolveReceiveType(type);

  const service = getRestateClassName(type);

  const classType = getTypeArgument(type, 1);

  const reflectionClass = ReflectionClass.from(classType);

  const methods: Record<string, ClassProxyMethod<unknown>> = {};

  return new Proxy(
    {},
    {
      get(target: any, method: string) {
        if (!methods[method]) {
          const reflectionMethod = reflectionClass.getMethod(method);
          if (reflectionMethod.parameters.length > 1) {
            throw new Error(`Handler "${method}" can only have one argument`);
          }

          const argsType = reflectionMethod.parameters[0]?.type;
          const serializeArgs = getJSONSerializer(
            undefined,
            undefined,
            undefined,
            argsType,
          );

          const returnType =
            getUnwrappedReflectionFunctionReturnType(reflectionMethod);
          const deserializeReturn = getJSONDeserializer(
            undefined,
            undefined,
            undefined,
            returnType,
          );

          methods[method] = {
            serializeArgs,
            deserializeReturn,
            argsType,
            returnType,
          };
        }
        const { serializeArgs, deserializeReturn, returnType, argsType } =
          methods[method];

        return (...args: readonly unknown[]): RestateHandlerRequest => {
          if (args.length > 1) {
            throw new Error(
              `Handler "${method}" can only have one argument, but got ${args.length}`,
            );
          }
          const data = argsType ? serializeArgs(args[0]) : undefined;
          return {
            service,
            method,
            data,
            returnType,
            deserializeReturn,
          };
        };
      },
    },
  );
}

export function provideRestateServiceProxy<
  T extends RestateService<string, any>,
>(type?: ReceiveType<T>) {
  type = resolveReceiveType(type);
  return {
    provide: type,
    useFactory: () => makeInterfaceProxy<T>(type),
  };
}

export function provideRestateObjectProxy<T extends RestateObject<string, any>>(
  type?: ReceiveType<T>,
) {
  type = resolveReceiveType(type);
  return {
    provide: type,
    useFactory: () => makeInterfaceProxy<T>(type),
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

export function fastHash(value: string | Uint8Array): string {
  return xxHash32(value).toString(16);
}

export function getTypeName(type: Type): string {
  if (!type.typeName) {
    throw new MissingTypeName(type);
  }
  return type.typeName;
}

// TODO: remove id from type
export function getTypeHash(type: Type): string {
  const jit = getTypeJitContainer(type);
  if (jit['hash']) return jit['hash'];
  jit['hash'] = fastHash(serializeBSON<SerializedTypes>(serializeType(type)));
  toFastProperties(jit);
  return jit['hash'];
}

export function getJSONSerializer<T>(
  options?: SerializationOptions,
  serializerToUse: Serializer = serializer,
  namingStrategy?: NamingStrategy,
  type?: ReceiveType<T>,
): (data: T) => JSONSingle<T> {
  return data =>
    serialize<T>(data, options, serializerToUse, namingStrategy, type);
}

export type JSONSerializer<T> = (data: T) => JSONSingle<T>;

export function getJSONDeserializer<T>(
  options?: SerializationOptions,
  serializerToUse: Serializer = serializer,
  namingStrategy?: NamingStrategy,
  type?: ReceiveType<T>,
): (data: JSONSingle<T>) => T {
  return data => cast<T>(data, options, serializerToUse, namingStrategy, type);
}

export type JSONDeserializer<T> = (data: JSONSingle<T>) => T;
