import { ClassType } from '@deepkit/core';
import {
  ClassDecoratorFn,
  createClassDecoratorContext,
  createPropertyDecoratorContext,
  DecoratorAndFetchSignature,
  deserializeFunction,
  DualDecorator,
  ExtractApiDataType,
  ExtractClass,
  mergeDecorator,
  PropertyDecoratorFn,
  PropertyDecoratorResult,
  ReceiveType,
  ReflectionClass,
  resolveReceiveType,
  serializeFunction,
  SerializeFunction,
  serializer,
  Type,
  TypeObjectLiteral,
  TypeTuple,
  UnionToIntersection,
} from '@deepkit/type';

import { RestateService, RestateServiceOptions } from './types';
import {
  assertRestateServiceType,
  createServiceMethodArgsType,
  getRestateServiceOptions,
  unwrapType,
} from './utils';

export class RestateServiceMetadata implements RestateServiceOptions {
  classType: ClassType;
  keyed?: boolean = false;
  type: TypeObjectLiteral;
  readonly methods = new Set<RestateServiceMethodMetadata>();
}

export class RestateClassDecorator {
  t = new RestateServiceMetadata();

  onDecorator(classType: ClassType) {
    this.t.classType = classType;
  }

  service<T extends RestateService<string, any>>(type?: ReceiveType<T>) {
    try {
      type = resolveReceiveType(type);
      assertRestateServiceType(type);
      const { keyed } = getRestateServiceOptions(type);
      this.t.type = type as TypeObjectLiteral;
      this.t.keyed = keyed;
    } catch (err) {
      if (
        err instanceof Error &&
        err.message !==
          'No type information received. Is deepkit/type correctly installed?'
      ) {
        throw err;
      }
    }
  }

  addMethod(action: RestateServiceMethodMetadata) {
    this.t.methods.add(action);
  }
}

export class RestateServiceMethodMetadata {
  name: string;
  returnType: Type;
  serializeReturn: SerializeFunction;
  argsType: TypeTuple;
  deserializeArgs: SerializeFunction;
  classType: ClassType;
}

export class RestatePropertyDecorator {
  t = new RestateServiceMethodMetadata();

  onDecorator(classType: ClassType, property: string | undefined) {
    if (!property) return;

    this.t.name = property;
    this.t.classType = classType;

    const reflectionClass = ReflectionClass.from(classType);
    const reflectionMethod = reflectionClass.getMethod(property);

    this.t.returnType = unwrapType(reflectionMethod.getReturnType());
    this.t.serializeReturn = serializeFunction(
      serializer,
      undefined,
      this.t.returnType,
    );

    this.t.argsType = createServiceMethodArgsType(reflectionMethod);
    this.t.deserializeArgs = deserializeFunction(
      serializer,
      undefined,
      this.t.argsType,
    );

    restateClassDecorator.addMethod(this.t)(classType);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  method() {}
}

// this workaround is necessary since generic functions (necessary for response<T>) are lost during a mapped type and changed ReturnType
// eslint-disable-next-line @typescript-eslint/ban-types
type RestateClassFluidDecorator<T, D extends Function> = {
  [name in keyof T]: name extends 'service'
    ? <For extends RestateService<string, any>>(
        type?: ReceiveType<For>,
      ) => D & RestateClassFluidDecorator<T, D>
    : T[name] extends (...args: infer K) => any
      ? (...args: K) => D & RestateClassFluidDecorator<T, D>
      : D & RestateClassFluidDecorator<T, D> & { _data: ExtractApiDataType<T> };
};

type RestateClassDecoratorResult = RestateClassFluidDecorator<
  ExtractClass<typeof RestateClassDecorator>,
  ClassDecoratorFn
> &
  DecoratorAndFetchSignature<typeof RestateClassDecorator, ClassDecoratorFn>;

export const restateClassDecorator: RestateClassDecoratorResult =
  createClassDecoratorContext(RestateClassDecorator);

//this workaround is necessary since generic functions are lost during a mapped type and changed ReturnType
type RestateMerge<U> = {
  [K in keyof U]: K extends 'service'
    ? <For extends RestateService<string, any>>(
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

export const restatePropertyDecorator: PropertyDecoratorResult<
  typeof RestatePropertyDecorator
> = createPropertyDecoratorContext(RestatePropertyDecorator);

export type MergedRestateDecorator = Omit<
  MergedRestate<
    [typeof restateClassDecorator, typeof restatePropertyDecorator]
  >,
  'addMethod'
>;

export const restate: MergedRestateDecorator = mergeDecorator(
  restateClassDecorator,
  restatePropertyDecorator,
) as any as MergedRestateDecorator;
