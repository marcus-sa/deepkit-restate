import { ReceiveType, typeOf } from '@deepkit/type';
import { Context as ServiceContext, ObjectContext, TerminalError, WorkflowContext } from '@restatedev/restate-sdk';
import { ClassType } from '@deepkit/core';
import { BSONDeserializer, BSONSerializer, getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';
import type { Send } from '@restatedev/restate-sdk-clients/dist/esm/src/api';
import type { RunAction } from '@restatedev/restate-sdk/dist/esm/src/context';

export type SendStatus = Omit<Send, 'attachable'>;

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

export interface RestateClientContext {
  // used for objects
  send(
    key: string,
    request: RestateObjectHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<SendStatus>;
  // used for services
  send(
    request: RestateServiceHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<SendStatus>;
  // used for objects
  rpc<R, A extends any[]>(
    key: string,
    request: RestateObjectHandlerRequest<R, A>,
  ): Promise<R>;
  // used for services
  rpc<R, A extends any[]>(call: RestateServiceHandlerRequest<R, A>): Promise<R>;
}

export interface RestateCustomContext extends RestateClientContext {
  run<T = void>(action: RunAction<T>, type?: ReceiveType<T>): Promise<T>;

  // run<T>(name: string, action: RunAction<T>): Promise<T>;
}

type ContextWithoutClients<T> = Omit<
  T,
  | 'serviceClient'
  | 'serviceSendClient'
  | 'objectSendClient'
  | 'objectClient'
  | 'run'
>;

export interface RestateServiceContext
  extends RestateCustomContext,
    ContextWithoutClients<ServiceContext> {
}

export interface RestateObjectContext
  extends RestateCustomContext,
    ContextWithoutClients<ObjectContext> {
}

export interface RestateHandlerResponse {
  readonly success: boolean;
  readonly data: Uint8Array;
  readonly typeName: string;
}

export interface RestateSagaContext
  extends Omit<RestateCustomContext, 'rpc' | 'send'>,
    ContextWithoutClients<WorkflowContext> {
}

export const restateServiceType = typeOf<RestateService<string, any, any[]>>();

export const restateHandlerResponseType = typeOf<RestateHandlerResponse>();

export const deserializeRestateHandlerResponse =
  getBSONDeserializer<RestateHandlerResponse>(
    undefined,
    restateHandlerResponseType,
  );

export const serializeRestateHandlerResponse = getBSONSerializer(
  undefined,
  restateHandlerResponseType,
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
