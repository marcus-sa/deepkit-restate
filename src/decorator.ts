import { ClassType } from '@deepkit/core';
import {
  ServiceHandlerOpts,
  ServiceOptions,
  ObjectOptions,
  WorkflowOptions,
} from '@restatedev/restate-sdk';
import {
  BSONDeserializer,
  BSONSerializer,
  deserializeBSON,
  getBSONDeserializer,
} from '@deepkit/bson';
import {
  ClassDecoratorFn,
  createClassDecoratorContext,
  createPropertyDecoratorContext,
  DecoratorAndFetchSignature,
  deserialize,
  DualDecorator,
  ExtractApiDataType,
  ExtractClass,
  isSameType,
  mergeDecorator,
  PropertyDecoratorFn,
  PropertyDecoratorResult,
  ReceiveType,
  ReflectionClass,
  ReflectionKind,
  resolveReceiveType,
  Serializer,
  stringifyType,
  Type,
  TypeClass,
  TypeObjectLiteral,
  TypeTuple,
  TypeUnion,
  UnionToIntersection,
} from '@deepkit/type';

import {
  RestateKafkaTopic,
  RestateObject,
  RestateSaga,
  RestateService,
} from './types.js';
import {
  assertValidKafkaTopicName,
  getJSONDeserializer,
  getJSONSerializer,
  getReflectionFunctionArgsType,
  getTypeName,
  getUnwrappedReflectionFunctionReturnType,
  JSONDeserializer,
  JSONSerializer,
} from './utils.js';
import {
  getRestateClassName,
  getRestateKafkaTopicArgsType,
  getRestateKafkaTopicSource,
} from './metadata.js';
import { RestateMiddleware, RestateMiddlewareType } from './middleware.js';

export class RestateClassMetadata {
  readonly name: string;
  readonly classType: ClassType;
  readonly type: TypeObjectLiteral | TypeClass;
  readonly handlers = new Set<RestateHandlerMetadata>();
  readonly middlewares = new Set<RestateMiddlewareType>();
}

// TODO: add enableLazyState for objects
export interface RestateHandlerOptions
  extends Omit<ServiceHandlerOpts<any, any>, 'input' | 'output' | 'accept'> {
  readonly serde?: 'json' | 'binary';
}

export class RestateServiceMetadata extends RestateClassMetadata {
  readonly options?: ServiceOptions;
}

export class RestateObjectMetadata extends RestateClassMetadata {
  readonly options?: ObjectOptions;
}

export class RestateSagaMetadata<T = unknown> extends RestateClassMetadata {
  readonly options?: WorkflowOptions;
  readonly deserializeData: BSONDeserializer<T>;
  readonly serializeData: BSONSerializer;
}

export class RestateServiceDecorator {
  t = new RestateServiceMetadata();

  onDecorator(classType: ClassType) {
    Object.assign(this.t, { classType });
  }

  addHandler(action: RestateHandlerMetadata) {
    this.t.handlers.add(action);
  }

  service<T extends RestateService<string, any>>(
    options?: ServiceOptions,
    type?: ReceiveType<T>,
  ) {
    type = resolveReceiveType(type);
    const name = getRestateClassName(type);
    Object.assign(this.t, {
      options,
      name,
      type,
    });
  }

  middleware(...middlewares: RestateMiddlewareType[]) {
    for (const middleware of middlewares) {
      this.t.middlewares.add(middleware);
    }
  }
}

export class RestateObjectDecorator {
  t = new RestateObjectMetadata();

  onDecorator(classType: ClassType) {
    Object.assign(this.t, { classType });
  }

  addHandler(action: RestateHandlerMetadata) {
    this.t.handlers.add(action);
  }

  object<T extends RestateObject<string, any>>(
    options?: ObjectOptions,
    type?: ReceiveType<T>,
  ) {
    type = resolveReceiveType(type);
    const name = getRestateClassName(type);
    Object.assign(this.t, {
      options,
      name,
      type,
    });
  }

  middleware(...middlewares: RestateMiddlewareType[]) {
    for (const middleware of middlewares) {
      this.t.middlewares.add(middleware);
    }
  }
}

export class RestateSagaDecorator {
  t = new RestateSagaMetadata();

  onDecorator(classType: ClassType) {
    Object.assign(this.t, { classType });
  }

  addHandler(action: RestateHandlerMetadata) {
    this.t.handlers.add(action);
  }

  middleware(...middlewares: RestateMiddlewareType[]) {
    for (const middleware of middlewares) {
      this.t.middlewares.add(middleware);
    }
  }
}

export type RestateKafkaHandlerOptions = Record<string, string>;

export interface RestateKafkaHandlerMetadata {
  readonly topic: string;
  readonly argsType: TypeTuple;
  readonly options?: RestateKafkaHandlerOptions;
}

export interface RestateEventHandlerTypeUnion extends TypeUnion {
  readonly types: (TypeObjectLiteral | TypeClass)[];
}

export interface RestateEventHandlerMetadata {
  readonly type: TypeClass | TypeObjectLiteral | RestateEventHandlerTypeUnion;
  readonly stream?: string;
}

export type EventBSONDeserializer<T> = (name: string, bson: Uint8Array) => T;

export class RestateHandlerMetadata<T = readonly unknown[]> {
  readonly name: string;
  readonly classType: ClassType;
  readonly returnType: Type;
  readonly argsType?: Type;
  readonly deserializeArgs: JSONDeserializer<T> | EventBSONDeserializer<T>;
  readonly shared?: boolean;
  readonly exclusive?: boolean;
  readonly kafka?: RestateKafkaHandlerMetadata;
  readonly event?: RestateEventHandlerMetadata;
  readonly options?: RestateHandlerOptions;
  readonly middlewares = new Set<RestateMiddlewareType>();
}

export class RestateHandlerDecorator {
  t = new RestateHandlerMetadata();

  onDecorator(classType: ClassType, property: string | undefined) {
    if (!property) return;

    const reflectionClass = ReflectionClass.from(classType);
    const reflectionMethod = reflectionClass.getMethod(property);

    const returnType =
      getUnwrappedReflectionFunctionReturnType(reflectionMethod);
    const serializeReturn = getJSONSerializer(
      undefined,
      undefined,
      undefined,
      returnType,
    );

    if (reflectionMethod.parameters.length > 1) {
      throw new Error(`Handler "${property}" can only have one argument`);
    }

    const argsType = reflectionMethod.parameters[0]?.type;
    const deserializeArgs =
      this.t.deserializeArgs ||
      getJSONDeserializer(undefined, undefined, undefined, argsType);

    Object.assign(this.t, {
      name: property,
      classType,
      returnType,
      serializeReturn,
      argsType,
      deserializeArgs,
    });

    restateObjectDecorator.addHandler(this.t)(classType);
    restateServiceDecorator.addHandler(this.t)(classType);
    restateSagaDecorator.addHandler(this.t)(classType);
  }

  handler(options?: RestateHandlerOptions) {
    Object.assign(this.t, { options });
  }

  event<T>(stream?: string, type?: ReceiveType<T>) {
    type = resolveReceiveType(type);
    Object.assign(this.t, {
      event: { type, stream },
    });
  }

  kafka<T extends RestateKafkaTopic<string, any[]>>(
    options?: Record<string, string>,
    type?: ReceiveType<T>,
  ) {
    type = resolveReceiveType(type);
    if (!this.t.argsType) {
      throw new Error('Missing args type');
    }

    const topic = getRestateKafkaTopicSource(type);
    assertValidKafkaTopicName(topic);

    const argsType = getRestateKafkaTopicArgsType(type);
    if (!isSameType(argsType, this.t.argsType)) {
      throw new Error(
        `Handler "${this.t.name}" parameters ${stringifyType(this.t.argsType)} does not match Kafka topic "${topic}" arguments ${stringifyType(argsType)}`,
      );
    }

    options = { 'allow.auto.create.topics': 'true', ...options };
    Object.assign(this.t, {
      kafka: { topic, argsType, options } satisfies RestateKafkaHandlerMetadata,
    });
  }

  // This only applies to workflows & objects
  shared() {
    if (this.t.exclusive) {
      throw new Error('Handler is already marked as exclusive');
    }
    Object.assign(this.t, { shared: true });
  }

  // This only applies to objects
  exclusive() {
    if (this.t.shared) {
      throw new Error('Handler is already marked as shared');
    }
    Object.assign(this.t, { exclusive: true });
  }

  middleware(...middlewares: RestateMiddlewareType[]) {
    for (const middleware of middlewares) {
      this.t.middlewares.add(middleware);
    }
  }
}

type RestateClassFluidDecorator<T, D extends Function> = {
  [K in keyof T]: K extends 'service'
    ? <For extends RestateService<string, any>>(
        options?: ServiceOptions,
        type?: ReceiveType<For>,
      ) => D & RestateClassFluidDecorator<T, D>
    : K extends 'object'
      ? <For extends RestateObject<string, any>>(
          options?: ObjectOptions,
          type?: ReceiveType<For>,
        ) => D & RestateClassFluidDecorator<T, D>
      : K extends 'saga'
        ? <For extends RestateSaga<string, any>>(
            type?: ReceiveType<For>,
          ) => D & RestateClassFluidDecorator<T, D>
        : T[K] extends (...args: infer K) => any
          ? (...args: K) => D & RestateClassFluidDecorator<T, D>
          : D &
              RestateClassFluidDecorator<T, D> & {
                _data: ExtractApiDataType<T>;
              };
};

type RestateServiceDecoratorResult = RestateClassFluidDecorator<
  ExtractClass<typeof RestateServiceDecorator>,
  ClassDecoratorFn
> &
  DecoratorAndFetchSignature<typeof RestateServiceDecorator, ClassDecoratorFn>;

export const restateServiceDecorator = createClassDecoratorContext(
  RestateServiceDecorator,
) as RestateServiceDecoratorResult;

type RestateObjectDecoratorResult = RestateClassFluidDecorator<
  ExtractClass<typeof RestateObjectDecorator>,
  ClassDecoratorFn
> &
  DecoratorAndFetchSignature<typeof RestateObjectDecorator, ClassDecoratorFn>;

export const restateObjectDecorator = createClassDecoratorContext(
  RestateObjectDecorator,
) as RestateObjectDecoratorResult;

type RestateSagaDecoratorResult = RestateClassFluidDecorator<
  ExtractClass<typeof RestateSagaDecorator>,
  ClassDecoratorFn
> &
  DecoratorAndFetchSignature<typeof RestateSagaDecorator, ClassDecoratorFn>;

export const restateSagaDecorator = createClassDecoratorContext(
  RestateSagaDecorator,
) as RestateSagaDecoratorResult;

type RestateMerge<U> = {
  [K in keyof U]: K extends 'service'
    ? <For extends RestateService<string, any>>(
        options?: ServiceOptions,
        type?: ReceiveType<For>,
      ) => (PropertyDecoratorFn | ClassDecoratorFn) & U
    : K extends 'object'
      ? <For extends RestateObject<string, any>>(
          options?: ObjectOptions,
          type?: ReceiveType<For>,
        ) => (PropertyDecoratorFn | ClassDecoratorFn) & U
      : K extends 'saga'
        ? <For extends RestateSaga<string, any>>(
            type?: ReceiveType<For>,
          ) => (PropertyDecoratorFn | ClassDecoratorFn) & U
        : K extends 'event'
          ? <T>(
              stream?: string,
              type?: ReceiveType<T>,
            ) => (PropertyDecoratorFn | ClassDecoratorFn) & U
          : U[K] extends (...a: infer A) => infer R
            ? R extends DualDecorator
              ? (...a: A) => (PropertyDecoratorFn | ClassDecoratorFn) & R & U
              : (...a: A) => R
            : never;
};

type MergedRestate<T extends any[]> = RestateMerge<
  Omit<UnionToIntersection<T[number]>, '_fetch' | 't'>
>;

export const restateHandlerDecorator: PropertyDecoratorResult<
  typeof RestateHandlerDecorator
> = createPropertyDecoratorContext(RestateHandlerDecorator);

export type MergedRestateDecorator = Omit<
  MergedRestate<
    [
      typeof restateObjectDecorator,
      typeof restateServiceDecorator,
      typeof restateSagaDecorator,
      typeof restateHandlerDecorator,
    ]
  >,
  'addHandler'
>;

export const restate: MergedRestateDecorator = mergeDecorator(
  restateObjectDecorator,
  restateServiceDecorator,
  restateSagaDecorator,
  restateHandlerDecorator,
) as any as MergedRestateDecorator;
