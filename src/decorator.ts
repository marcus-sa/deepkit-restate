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
  getBSONDeserializer,
} from '@deepkit/bson';
import {
  ClassDecoratorFn,
  createClassDecoratorContext,
  createPropertyDecoratorContext,
  DecoratorAndFetchSignature,
  DualDecorator,
  ExtractApiDataType,
  ExtractClass,
  isSameType,
  mergeDecorator,
  PropertyDecoratorFn,
  PropertyDecoratorResult,
  ReceiveType,
  ReflectionClass,
  resolveReceiveType,
  stringifyType,
  Type,
  TypeClass,
  TypeObjectLiteral,
  TypeTuple,
  UnionToIntersection,
} from '@deepkit/type';

import {
  getResponseDataSerializer,
  getSagaDataDeserializer,
  getSagaDataSerializer,
} from './serde.js';
import {
  RestateKafkaTopic,
  RestateObject,
  RestateSaga,
  RestateService,
} from './types.js';
import {
  assertValidKafkaTopicName,
  getReflectionFunctionArgsType,
  getUnwrappedReflectionFunctionReturnType,
} from './utils.js';
import {
  getRestateClassName,
  getRestateKafkaTopicArgsType,
  getRestateKafkaTopicSource,
} from './metadata.js';
import { RestateMiddleware } from './middleware.js';

export class RestateClassMetadata {
  readonly name: string;
  readonly classType: ClassType;
  readonly type: TypeObjectLiteral | TypeClass;
  readonly handlers = new Set<RestateHandlerMetadata>();
  readonly middlewares: ClassType<RestateMiddleware>[] = [];
}

// TODO: add enableLazyState for objects
export interface RestateHandlerOptions
  extends Omit<ServiceHandlerOpts<any, any>, 'input' | 'output' | 'accept'> {
  readonly bson?: boolean;
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

  middleware(...middlewares: ClassType<RestateMiddleware>[]) {
    this.t.middlewares.push(...middlewares);
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

  middleware(...middlewares: ClassType<RestateMiddleware>[]) {
    this.t.middlewares.push(...middlewares);
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

  saga<T extends RestateSaga<string, any>>(type?: ReceiveType<T>) {
    type = resolveReceiveType(type);
    const name = getRestateClassName(type);
    const deserializeData = getSagaDataDeserializer(type);
    const serializeData = getSagaDataSerializer(type);
    Object.assign(this.t, {
      name,
      type,
      deserializeData,
      serializeData,
    });
  }

  middleware(...middlewares: ClassType<RestateMiddleware>[]) {
    this.t.middlewares.push(...middlewares);
  }
}

export type RestateKafkaHandlerOptions = Record<string, string>;

export interface RestateKafkaHandlerMetadata {
  readonly topic: string;
  readonly argsType: TypeTuple;
  readonly options?: RestateKafkaHandlerOptions;
}

export interface RestateEventHandlerMetadata {
  readonly type: TypeClass | TypeObjectLiteral;
  readonly stream?: string;
}

export class RestateHandlerMetadata<T = readonly unknown[]> {
  readonly name: string;
  readonly classType: ClassType;
  readonly returnType: Type;
  readonly argsType: TypeTuple;
  readonly serializeReturn: BSONSerializer;
  readonly deserializeArgs: BSONDeserializer<T>;
  readonly shared?: boolean;
  readonly exclusive?: boolean;
  readonly kafka?: RestateKafkaHandlerMetadata;
  readonly event?: RestateEventHandlerMetadata;
  readonly options?: RestateHandlerOptions;
  readonly middlewares: ClassType<RestateMiddleware>[] = [];
}

export class RestateHandlerDecorator {
  t = new RestateHandlerMetadata();

  onDecorator(classType: ClassType, property: string | undefined) {
    if (!property) return;

    const reflectionClass = ReflectionClass.from(classType);
    const reflectionMethod = reflectionClass.getMethod(property);

    const returnType =
      getUnwrappedReflectionFunctionReturnType(reflectionMethod);
    const serializeReturn = getResponseDataSerializer(returnType);

    const argsType = getReflectionFunctionArgsType(reflectionMethod);
    const deserializeArgs =
      this.t.deserializeArgs || getBSONDeserializer(undefined, argsType);

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

  // FIXME: options and type are somehow required
  event<T>(type?: ReceiveType<T>, stream?: string) {
    type = resolveReceiveType(type);
    const deserialize = getBSONDeserializer(undefined, type);
    Object.assign(this.t, {
      event: { type, stream },
      deserializeArgs: (bson: Uint8Array) => [deserialize(bson)],
    });
  }

  // FIXME: options and type are somehow required
  kafka<T extends RestateKafkaTopic<string, any[]>>(
    options?: Record<string, string>,
    type?: ReceiveType<T>,
  ) {
    type = resolveReceiveType(type);

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

  middleware(...middlewares: ClassType<RestateMiddleware>[]) {
    this.t.middlewares.push(...middlewares);
  }
}

type RestateClassFluidDecorator<T, D extends Function> = {
  [K in keyof T]: K extends 'service' | 'object'
    ? <For extends RestateService<string, any> | RestateObject<string, any>>(
        type?: ReceiveType<For>,
      ) => D & RestateClassFluidDecorator<T, D>
    : K extends 'saga'
      ? <For extends RestateSaga<string, any>>(
          type?: ReceiveType<For>,
        ) => D & RestateClassFluidDecorator<T, D>
      : T[K] extends (...args: infer K) => any
        ? (...args: K) => D & RestateClassFluidDecorator<T, D>
        : D &
            RestateClassFluidDecorator<T, D> & { _data: ExtractApiDataType<T> };
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
  [K in keyof U]: K extends 'service' | 'object'
    ? <For extends RestateService<string, any> | RestateObject<any, any>>(
        type?: ReceiveType<For>,
      ) => (PropertyDecoratorFn | ClassDecoratorFn) & U
    : K extends 'saga'
      ? <For extends RestateSaga<string, any>>(
          type?: ReceiveType<For>,
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
