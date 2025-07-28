import { ReceiveType, typeOf } from '@deepkit/type';
import { BSONDeserializer } from '@deepkit/bson';
import {
  Context,
  InvocationId,
  type ObjectContext,
  ObjectSharedContext,
  RestatePromise,
  RunOptions,
  TerminalError,
  WorkflowContext,
} from '@restatedev/restate-sdk';

export interface RestateInvocationHandle {
  invocationId: string;
}

export type RestateRunAction<T> = () => Promise<T> | T;

export interface RestateApiInvocation {
  readonly id: string;
}

export interface RestateSendOptions {
  readonly delay?: number;
  readonly idempotencyKey?: string;
}

export interface RestateCallOptions {
  readonly idempotencyKey?: string;
}

type RestateHandlerType = 'object' | 'service';

export interface RestateHandlerRequest<
  R = any,
  A extends any[] = [],
  T extends RestateHandlerType = any,
> {
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

export type RestateService<Name extends string, Interface> = {
  [Method in keyof Interface as Interface[Method] extends never
    ? never
    : Method]: RestateServiceHandler<Interface[Method]>;
};

export type RestateObject<Name extends string, Interface> = {
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
  readonly promise: RestatePromise<T>;
}

export interface RestateClient {
  // used for objects
  send(
    key: string,
    request: RestateObjectHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<RestateInvocationHandle> | void;
  // used for services
  send(
    request: RestateServiceHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<RestateInvocationHandle> | void;
  // used for objects
  call<R, A extends any[]>(
    key: string,
    request: RestateObjectHandlerRequest<R, A>,
  ): Promise<R>;
  // used for services
  call<R, A extends any[]>(
    call: RestateServiceHandlerRequest<R, A>,
  ): Promise<R>;
}

export interface RestateCustomContext extends RestateClient {
  awakeable<T>(type?: ReceiveType<T>): RestateAwakeable<T>;
  resolveAwakeable<T>(
    id: string,
    payload: NoInfer<T>,
    type?: ReceiveType<T>,
  ): void;
  rejectAwakeable(id: string, reason: string): void;
  attach<T>(
    invocationId: InvocationId,
    type?: ReceiveType<T>,
  ): RestatePromise<T>;
  // run should only return a value if a generic is provided
  run(
    name: string,
    action: RestateRunAction<unknown>,
    options?: Omit<RunOptions<unknown>, 'serde'>,
  ): RestatePromise<void>;
  run<T>(
    name: string,
    action: RestateRunAction<T>,
    options?: Omit<RunOptions<unknown>, 'serde'>,
    type?: ReceiveType<T>,
  ): RestatePromise<T>;
}

type ContextWithoutClients<T> = Omit<
  T,
  | 'workflowClient'
  | 'workflowSendClient'
  | 'serviceClient'
  | 'serviceSendClient'
  | 'objectClient'
  | 'objectSendClient'
  | 'attach'
  | 'run'
  | 'get'
  | 'set'
  | 'resolveAwakeable'
  | 'awakeable'
>;

export interface RestateServiceContext
  extends RestateCustomContext,
    ContextWithoutClients<Context> {}

export interface RestateObjectContext
  extends RestateCustomContext,
    ContextWithoutClients<ObjectContext> {
  get<T>(name: string, type?: ReceiveType<T>): Promise<T | null>;
  set<T>(name: string, value: T, type?: ReceiveType<T>): void;
}

export interface RestateSharedObjectContext
  extends RestateCustomContext,
    ContextWithoutClients<ObjectSharedContext> {
  get<T>(name: string, type?: ReceiveType<T>): Promise<T | null>;
}

export interface RestateWorkflowContext
  extends RestateObjectContext,
    ContextWithoutClients<WorkflowContext> {}

export interface RestateHandlerResponse {
  readonly success?: boolean;
  readonly data?: Uint8Array;
  readonly typeName?: string;
}

export interface RestateCustomTerminalErrorMessage {
  readonly data: Uint8Array;
  readonly entityName: string;
}

export interface RestateSagaContext
  extends Omit<RestateWorkflowContext, 'call' | 'send'>,
    ContextWithoutClients<WorkflowContext> {}

export const restateServiceType = typeOf<RestateService<string, any>>();

export const restateHandlerResponseType = typeOf<RestateHandlerResponse>();

export const restateObjectType = typeOf<RestateObject<string, any>>();

export const restateSagaType = typeOf<RestateSaga<string, any>>();

export const restateServiceContextType = typeOf<RestateServiceContext>();

export const restateClientType = typeOf<RestateClient>();

export const restateObjectContextType = typeOf<RestateObjectContext>();

export const restateSagaContextType = typeOf<RestateSagaContext>();

export const restateTerminalErrorType = typeOf<TerminalError>();

export const SCOPE = 'restate';
