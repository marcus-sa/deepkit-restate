import { ReceiveType, typeOf } from '@deepkit/type';
import { ClassType } from '@deepkit/core';
import { BSONDeserializer } from '@deepkit/bson';
import {
  CombineablePromise,
  Context as ServiceContext,
  ObjectContext,
  TerminalError,
  WorkflowContext,
} from '@restatedev/restate-sdk';

export interface RestateStatus {
  invocationId: string;
  status: 'Accepted' | 'PreviouslyAccepted';
}

export type RestateRunAction<T> = () => Promise<T> | T;

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

export interface RestateAwakeable<T> {
  readonly id: string;
  readonly promise: CombineablePromise<T>;
}

export interface RestateCustomContext {
  awakeable<T>(type?: ReceiveType<T>): RestateAwakeable<T>;
  resolveAwakeable<T>(id: string, payload: T, type?: ReceiveType<T>): void;
  rejectAwakeable(id: string, reason: string): void;
  // run should only return a value if a generic is provided
  run(action: RestateRunAction<unknown>): Promise<void>;
  run<T>(action: RestateRunAction<T>, type?: ReceiveType<T>): Promise<T>;
  // used for objects
  send(
    key: string,
    request: RestateObjectHandlerRequest,
    options?: RestateSendOptions,
  ): void; // Promise<RestateStatus>
  // used for services
  send(
    request: RestateServiceHandlerRequest,
    options?: RestateSendOptions,
  ): void; // Promise<RestateStatus>
  // used for objects
  rpc<R, A extends any[]>(
    key: string,
    request: RestateObjectHandlerRequest<R, A>,
  ): Promise<R>;
  // used for services
  rpc<R, A extends any[]>(call: RestateServiceHandlerRequest<R, A>): Promise<R>;
}

type ContextWithoutClients<T> = Omit<
  T,
  | 'workflowClient'
  | 'workflowSendClient'
  | 'serviceClient'
  | 'serviceSendClient'
  | 'objectClient'
  | 'objectSendClient'
  | 'run'
  | 'resolveAwakeable'
  | 'awakeable'
>;

export interface RestateServiceContext
  extends RestateCustomContext,
    ContextWithoutClients<ServiceContext> {}

export interface RestateObjectContext
  extends RestateCustomContext,
    ContextWithoutClients<ObjectContext> {}

export interface RestateHandlerResponse {
  readonly success: boolean;
  readonly data?: Uint8Array;
  readonly typeName?: string;
}

export interface RestateSagaContext
  extends Omit<RestateCustomContext, 'rpc' | 'send'>,
    ContextWithoutClients<WorkflowContext> {}

export const restateServiceType = typeOf<RestateService<string, any, any[]>>();

export const restateHandlerResponseType = typeOf<RestateHandlerResponse>();

export const restateObjectType = typeOf<RestateObject<string, any, any[]>>();

export const restateSagaType = typeOf<RestateSaga<string, any>>();

export const restateServiceContextType = typeOf<RestateServiceContext>();

export const restateObjectContextType = typeOf<RestateObjectContext>();

export const restateSagaContextType = typeOf<RestateSagaContext>();

export const restateTerminalErrorType = typeOf<TerminalError>();

export const SCOPE = 'restate';
