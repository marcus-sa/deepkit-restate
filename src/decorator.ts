import { ClassType } from '@deepkit/core';
import {
  bsonBinarySerializer,
  BSONDeserializer,
  BSONSerializer,
  getBSONDeserializer,
  getBSONSerializer,
} from '@deepkit/bson';
import {
  ClassDecoratorFn,
  createClassDecoratorContext,
  createPropertyDecoratorContext,
  DecoratorAndFetchSignature,
  DualDecorator,
  ExtractApiDataType,
  ExtractClass,
  mergeDecorator,
  PropertyDecoratorFn,
  PropertyDecoratorResult,
  ReceiveType,
  ReflectionClass,
  resolveReceiveType,
  Type,
  TypeClass,
  TypeObjectLiteral,
  UnionToIntersection,
} from '@deepkit/type';

import { Entities, RestateObject, RestateSaga, RestateService } from './types.js';
import {
  getReflectionFunctionArgsType,
  getRestateClassEntities,
  getRestateClassName,
  getSagaDataDeserializer,
  getSagaDataSerializer,
  getUnwrappedReflectionFunctionReturnType,
} from './utils.js';

export class RestateClassMetadata {
  readonly name: string;
  readonly classType: ClassType;
  readonly entities: Entities = new Map();
  readonly type: TypeObjectLiteral | TypeClass;
  readonly handlers = new Set<RestateHandlerMetadata>();
}

export class RestateServiceMetadata extends RestateClassMetadata {}

export class RestateObjectMetadata extends RestateClassMetadata {}

export class RestateSagaMetadata<T = unknown> extends RestateClassMetadata {
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

  service<T extends RestateService<string, any, any[]>>(type?: ReceiveType<T>) {
    type = resolveReceiveType(type);
    const name = getRestateClassName(type);
    const entities = getRestateClassEntities(type);
    Object.assign(this.t, {
      entities,
      name,
      type,
    });
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

  object<T extends RestateObject<string, any, any[]>>(type?: ReceiveType<T>) {
    type = resolveReceiveType(type);
    const name = getRestateClassName(type);
    const entities = getRestateClassEntities(type);
    Object.assign(this.t, {
      entities,
      name,
      type,
    });
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
}

export class RestateHandlerMetadata<T = readonly unknown[]> {
  readonly name: string;
  readonly classType: ClassType;
  readonly returnType: Type;
  readonly serializeReturn: BSONSerializer;
  readonly deserializeArgs: BSONDeserializer<T>;
}

export class RestateHandlerDecorator {
  t = new RestateHandlerMetadata();

  onDecorator(classType: ClassType, property: string | undefined) {
    if (!property) return;

    const reflectionClass = ReflectionClass.from(classType);
    const reflectionMethod = reflectionClass.getMethod(property);

    const returnType =
      getUnwrappedReflectionFunctionReturnType(reflectionMethod);
    const serializeReturn = getBSONSerializer(bsonBinarySerializer, returnType);

    const argsType = getReflectionFunctionArgsType(reflectionMethod);
    const deserializeArgs = getBSONDeserializer(bsonBinarySerializer, argsType);

    Object.assign(this.t, {
      name: property,
      classType,
      returnType,
      serializeReturn,
      deserializeArgs,
    });

    restateObjectDecorator.addHandler(this.t)(classType);
    restateServiceDecorator.addHandler(this.t)(classType);
    restateSagaDecorator.addHandler(this.t)(classType);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler() {
  }
}

type RestateClassFluidDecorator<T, D extends Function> = {
  [K in keyof T]: K extends 'service'
    ? <
      For extends
          | RestateService<string, any, any[]>
        | RestateObject<string, any, any[]>,
    >(
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
  [K in keyof U]: K extends 'service'
    ? <
      For extends
          | RestateService<string, any, any[]>
        | RestateObject<any, any, any[]>,
    >(
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
