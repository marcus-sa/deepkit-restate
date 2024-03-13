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

import {
  Entities,
  RestateKeyedService,
  RestateSaga,
  RestateService,
} from './types';
import {
  getReflectionFunctionArgsType,
  getUnwrappedReflectionFunctionReturnType,
  assertRestateSagaType,
  getRestateServiceName,
  getRestateSagaName,
  getRestateServiceEntities,
  isRestateServiceKeyed,
  getSagaDataType,
  getSagaDataDeserializer,
  getSagaDataSerializer,
} from './utils';

export class RestateServiceMetadata {
  readonly name: string;
  classType: ClassType;
  readonly keyed: boolean;
  readonly entities: Entities = new Map();
  readonly type: TypeObjectLiteral;
  readonly methods = new Set<RestateServiceMethodMetadata>();
}

export class RestateSagaMetadata<T = unknown> {
  readonly name: string;
  classType: ClassType;
  readonly type: TypeClass | TypeObjectLiteral;
  readonly deserializeData: BSONDeserializer<T>;
  readonly serializeData: BSONSerializer;
}

export class RestateClassMetadata {
  service?: RestateServiceMetadata = new RestateServiceMetadata();
  saga?: RestateSagaMetadata = new RestateSagaMetadata();
}

export class RestateClassDecorator {
  t = new RestateClassMetadata();

  onDecorator(classType: ClassType) {
    (this.t.service || this.t.saga)!.classType = classType;
  }

  service<
    T extends
      | RestateService<string, any, any[]>
      | RestateKeyedService<string, any, any[]>,
  >(type?: ReceiveType<T>) {
    type = resolveReceiveType(type);
    const name = getRestateServiceName(type);
    const entities = getRestateServiceEntities(type);
    const keyed = isRestateServiceKeyed(type);
    delete this.t.saga;
    Object.assign(this.t.service!, {
      entities,
      name,
      type,
      keyed,
    });
  }

  addServiceMethod(action: RestateServiceMethodMetadata) {
    this.t.service!.methods.add(action);
  }

  saga<T extends RestateSaga<string, any>>(type?: ReceiveType<T>) {
    type = resolveReceiveType(type);
    const name = getRestateSagaName(type);
    const deserializeData = getSagaDataDeserializer(type);
    const serializeData = getSagaDataSerializer(type);
    delete this.t.service;
    Object.assign(this.t.saga!, {
      name,
      type,
      deserializeData,
      serializeData,
    });
  }
}

export class RestateServiceMethodMetadata<T = readonly unknown[]> {
  name: string;
  classType: ClassType;
  returnType: Type;
  serializeReturn: BSONSerializer;
  deserializeArgs: BSONDeserializer<T>;
}

export class RestatePropertyDecorator {
  t = new RestateServiceMethodMetadata();

  onDecorator(classType: ClassType, property: string | undefined) {
    if (!property) return;

    this.t.name = property;
    this.t.classType = classType;

    const reflectionClass = ReflectionClass.from(classType);
    const reflectionMethod = reflectionClass.getMethod(property);

    this.t.returnType =
      getUnwrappedReflectionFunctionReturnType(reflectionMethod);
    this.t.serializeReturn = getBSONSerializer(
      bsonBinarySerializer,
      this.t.returnType,
    );

    const argsType = getReflectionFunctionArgsType(reflectionMethod);
    this.t.deserializeArgs = getBSONDeserializer(
      bsonBinarySerializer,
      argsType,
    );

    restateClassDecorator.addServiceMethod(this.t)(classType);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  method() {}
}

// this workaround is necessary since generic functions (necessary for response<T>) are lost during a mapped type and changed ReturnType
// eslint-disable-next-line @typescript-eslint/ban-types
// type RestateClassFluidDecorator<T, D extends Function> = {
//   [name in keyof T]: name extends 'service'
//     ? <For extends RestateService<string, any>>(
//         type?: ReceiveType<For>,
//       ) => D & RestateClassFluidDecorator<T, D>
//     : T[name] extends (...args: infer K) => any
//       ? (...args: K) => D & RestateClassFluidDecorator<T, D>
//       : D & RestateClassFluidDecorator<T, D> & { _data: ExtractApiDataType<T> };
// };

type RestateClassFluidDecorator<T, D extends Function> = {
  [K in keyof T]: K extends 'service'
    ? <
        For extends
          | RestateService<string, any, any[]>
          | RestateKeyedService<string, any, any[]>,
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

type RestateClassDecoratorResult = RestateClassFluidDecorator<
  ExtractClass<typeof RestateClassDecorator>,
  ClassDecoratorFn
> &
  DecoratorAndFetchSignature<typeof RestateClassDecorator, ClassDecoratorFn>;

export const restateClassDecorator: RestateClassDecoratorResult =
  createClassDecoratorContext(RestateClassDecorator);

//this workaround is necessary since generic functions are lost during a mapped type and changed ReturnType
// type RestateMerge<U> = {
//   [K in keyof U]: K extends 'service'
//     ? <For extends RestateService<string, any>>(
//         type?: ReceiveType<For>,
//       ) => (PropertyDecoratorFn | ClassDecoratorFn) & U
//     : U[K] extends (...a: infer A) => infer R
//       ? R extends DualDecorator
//         ? (...a: A) => (PropertyDecoratorFn | ClassDecoratorFn) & R & U
//         : (...a: A) => R
//       : never;
// };

type RestateMerge<U> = {
  [K in keyof U]: K extends 'service'
    ? <
        For extends
          | RestateService<string, any, any[]>
          | RestateKeyedService<any, any, any[]>,
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

export const restatePropertyDecorator: PropertyDecoratorResult<
  typeof RestatePropertyDecorator
> = createPropertyDecoratorContext(RestatePropertyDecorator);

export type MergedRestateDecorator = Omit<
  MergedRestate<
    [typeof restateClassDecorator, typeof restatePropertyDecorator]
  >,
  'addServiceMethod'
>;

export const restate: MergedRestateDecorator = mergeDecorator(
  restateClassDecorator,
  restatePropertyDecorator,
) as any as MergedRestateDecorator;
