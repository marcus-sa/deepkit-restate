import { typeOf, uint8 } from '@deepkit/type';
import { Context as ServiceContext, ObjectContext, TerminalError, WorkflowContext } from '@restatedev/restate-sdk';
import { ClassType } from '@deepkit/core';
import { BSONDeserializer, BSONSerializer, getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';

export interface RestateApiInvocation {
  readonly id: string;
}

export interface RestateSendOptions {
  readonly delay?: string;
  readonly idempotencyKey?: string;
}

export interface RestateRpcOptions {
  readonly idempotencyKey?: string;
}

export interface Entity<T> {
  readonly classType: ClassType<T>;
  readonly serialize: BSONSerializer;
  readonly deserialize: BSONDeserializer<T>;
}

export type Entities = Map<string, Entity<unknown>>;

type RestateMethodType = 'object' | 'service';

export interface RestateMethodRequest<
  R = any,
  A extends any[] = [],
  T extends RestateMethodType = any,
> {
  readonly entities: Entities;
  readonly service: string;
  readonly method: string;
  readonly data: Uint8Array;
  readonly deserializeReturn: BSONDeserializer<R>;
  /** @internal */
  readonly __type?: T;
}

export type RestateObjectMethodRequest<
  R = any,
  A extends any[] = [],
> = RestateMethodRequest<R, A, 'object'>;

export type RestateServiceMethodRequest<
  R = any,
  A extends any[] = [],
> = RestateMethodRequest<R, A, 'service'>;

export type RestateRpcRequest = readonly uint8[];

export type RestateRpcResponse = readonly uint8[];

type RestateMethod<F, T extends RestateMethodType> = F extends (
    ...args: infer P
  ) => infer R
  ? (...args: P) => RestateMethodRequest<Awaited<R>, P, T>
  : never;

export type RestateObjectMethod<F> = RestateMethod<F, 'object'>;

export type RestateServiceMethod<F> = RestateMethod<F, 'service'>;

export type RestateService<
  Name extends string,
  Interface,
  Entities extends any[] = [],
> = {
  [Method in keyof Interface as Interface[Method] extends never
    ? never
    : Method]: RestateServiceMethod<Interface[Method]>;
};

export type RestateObject<
  Name extends string,
  Interface,
  Entities extends any[] = [],
> = {
  [Method in keyof Interface as Interface[Method] extends never
    ? never
    : Method]: RestateObjectMethod<Interface[Method]>;
};

export interface RestateSaga<Name extends string, Data> {
  readonly name: Name;
  readonly data: Data;
}

export interface RestateCustomContext {
  // used for objects
  send(
    key: string,
    call: RestateObjectMethodRequest,
    options?: RestateSendOptions,
  ): Promise<void>;
  // used for services
  send(
    call: RestateServiceMethodRequest,
    options?: RestateSendOptions,
  ): Promise<void>;
  // used for objects
  rpc<R, A extends any[]>(
    key: string,
    call: RestateObjectMethodRequest<R, A>,
  ): Promise<R>;
  // used for services
  rpc<R, A extends any[]>(call: RestateServiceMethodRequest<R, A>): Promise<R>;
}

type ContextWithoutClients<T> = Omit<
  T,
  'serviceClient' | 'serviceSendClient' | 'objectSendClient' | 'objectClient'
>;

export interface RestateServiceContext
  extends RestateCustomContext,
    ContextWithoutClients<ServiceContext> {
}

export interface RestateObjectContext
  extends RestateCustomContext,
    ContextWithoutClients<ObjectContext> {
}

export interface RestateMethodResponse {
  readonly success: boolean;
  readonly data: Uint8Array;
  readonly typeName: string;
}

export interface RestateSagaContext
  extends ContextWithoutClients<WorkflowContext> {}

export const restateServiceType = typeOf<RestateService<string, any, any[]>>();

export const restateMethodResponseType = typeOf<RestateMethodResponse>();

export const deserializeRestateMethodResponse =
  getBSONDeserializer<RestateMethodResponse>(
    undefined,
    restateMethodResponseType,
  );

export const serializeRestateMethodResponse = getBSONSerializer(
  undefined,
  restateMethodResponseType,
);

export const restateObjectType = typeOf<RestateObject<string, any, any[]>>();

export const restateSagaType = typeOf<RestateSaga<string, any>>();

export const restateServiceContextType = typeOf<RestateServiceContext>();

export const restateObjectContextType = typeOf<RestateObjectContext>();

export const restateTerminalErrorType = typeOf<TerminalError>();

export const serializeRestateTerminalErrorType = getBSONSerializer(
  undefined,
  restateTerminalErrorType,
);

export const deserializeRestateTerminalErrorType =
  getBSONDeserializer<TerminalError>(undefined, restateTerminalErrorType);

export const restateSagaContextType = typeOf<RestateSagaContext>();

export const SCOPE = 'restate';
