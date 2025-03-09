import { BSONDeserializer } from '@deepkit/bson';
import { ClassType } from '@deepkit/core';
import { typeOf } from '@deepkit/type';
import { TerminalError } from '@restatedev/restate-sdk';

export interface RestateStatus {
  readonly invocationId: string;
  readonly status: 'Accepted' | 'PreviouslyAccepted';
}

export type RestateRunAction<T> = () => Promise<T> | T;

export interface RestateApiInvocation {
  readonly id: string;
}

export interface RestateSendOptions {
  readonly delay?: string;
  readonly idempotencyKey?: string;
}

export interface RestateCallOptions {
  readonly idempotencyKey?: string;
}

export type Entities = Map<string, ClassType<unknown>>;

type RestateHandlerType = 'object' | 'service';

export interface RestateHandlerRequest<
  R = any,
  A extends any[] = [],
  T extends RestateHandlerType = any,
> {
  readonly entities: Entities;
  readonly service: string;
  readonly method: string;
  readonly data: Uint8Array;
  readonly deserializeReturn: BSONDeserializer<R>;
  /** @internal */
  readonly __type?: T;
}

export interface RestateKafkaTopic<T extends string, A extends any[]> {
  readonly topic: T;
  readonly args: A;
}

export type RestateObjectHandlerRequest<
  R = any,
  A extends any[] = [],
> = RestateHandlerRequest<R, A, 'object'>;

export type RestateServiceHandlerRequest<
  R = any,
  A extends any[] = [],
> = RestateHandlerRequest<R, A, 'service'>;

type RestateHandler<F, T extends RestateHandlerType> = F extends (
  ...args: infer P
) => infer R
  ? (...args: P) => RestateHandlerRequest<Awaited<R>, P, T>
  : never;

export type RestateObjectHandler<F> = RestateHandler<F, 'object'>;

export type RestateServiceHandler<F> = RestateHandler<F, 'service'>;

export type RestateService<
  Name extends string,
  Interface,
  Entities extends any[] = [],
> = {
  [Method in keyof Interface as Interface[Method] extends never
    ? never
    : Method]: RestateServiceHandler<Interface[Method]>;
};

export type RestateObject<
  Name extends string,
  Interface,
  Entities extends any[] = [],
> = {
  [Method in keyof Interface as Interface[Method] extends never
    ? never
    : Method]: RestateObjectHandler<Interface[Method]>;
};

export interface RestateSaga<Name extends string, Data> {
  readonly name: Name;
  readonly data: Data;
}

export interface RestateHandlerResponse {
  readonly success: boolean;
  readonly data?: Uint8Array;
  readonly typeName?: string;
}

export const restateServiceType = typeOf<RestateService<string, any, any[]>>();

export const restateHandlerResponseType = typeOf<RestateHandlerResponse>();

export const restateObjectType = typeOf<RestateObject<string, any, any[]>>();

export const restateSagaType = typeOf<RestateSaga<string, any>>();

export const restateTerminalErrorType = typeOf<TerminalError>();

export const SCOPE = 'restate';
