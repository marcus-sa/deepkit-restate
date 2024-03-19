import { typeOf, uint8 } from '@deepkit/type';
import {
  Context,
  KeyedContext,
  TerminalError,
  workflow,
} from '@restatedev/restate-sdk';
import { getContainerToken } from '@deepkit/injector';
import { ClassType } from '@deepkit/core';
import {
  bsonBinarySerializer,
  BSONDeserializer,
  BSONSerializer,
  getBSONDeserializer,
  getBSONSerializer,
} from '@deepkit/bson';

export interface RestateApiInvocation {
  readonly id: string;
}

export interface RestateClientCallOptions {
  readonly key?: string;
  readonly timeout?: number;
}

export interface CustomContext {
  send(
    call: RestateServiceMethodRequest,
    options?: RestateClientCallOptions,
  ): Promise<void>;
  sendDelayed(
    call: RestateServiceMethodRequest,
    ms: number,
    options?: RestateClientCallOptions,
  ): Promise<void>;
  rpc<R, A extends any[]>(call: RestateServiceMethodRequest<R, A>): Promise<R>;
}

export interface Entity<T> {
  readonly classType: ClassType;
  readonly serialize: BSONSerializer;
  readonly deserialize: BSONDeserializer<T>;
}

export type Entities = Map<string, Entity<unknown>>;

export interface RestateServiceMethodRequest<R = any, A extends any[] = []> {
  readonly keyed: boolean;
  readonly entities: Entities;
  readonly service: string;
  readonly method: string;
  readonly data: RestateRpcRequest;
  readonly deserializeReturn: BSONDeserializer<R>;
}

export type RestateRpcRequest = readonly uint8[];

export type RestateRpcResponse = readonly uint8[];

type RestateServiceMethod<F> = F extends (...args: infer P) => infer R
  ? (...args: P) => RestateServiceMethodRequest<Awaited<R>, P>
  : never;

export interface RestateServiceOptions {
  readonly keyed: boolean;
}

export type RestateService<
  Name extends string,
  Interface,
  Entities extends any[] = [],
> = {
  [Method in keyof Interface as Interface[Method] extends never
    ? never
    : Method]: RestateServiceMethod<Interface[Method]>;
};

export type RestateKeyedService<
  Name extends string,
  Interface,
  Entities extends any[] = [],
> = {
  [Method in keyof Interface as Interface[Method] extends never
    ? never
    : Method]: RestateServiceMethod<Interface[Method]>;
};

export interface RestateSaga<Name extends string, Data> {
  readonly name: Name;
  readonly data: Data;
}

export type RestateContext = CustomContext &
  Omit<Context, 'rpc' | 'send' | 'sendDelayed'>;

export interface RestateKeyedContext
  extends CustomContext,
    Omit<KeyedContext, 'rpc' | 'send' | 'sendDelayed'> {
  readonly key: string;
}

export interface RestateServiceMethodResponse {
  readonly success: boolean;
  readonly data: Uint8Array;
  readonly typeName: string;
}

export interface RestateSagaContext
  extends Omit<workflow.WfContext, 'rpc' | 'send' | 'sendDelayed'> {}

export const restateServiceType = typeOf<RestateService<string, any, any[]>>();

export const restateServiceMethodResponseType =
  typeOf<RestateServiceMethodResponse>();

export const deserializeRestateServiceMethodResponse =
  getBSONDeserializer<RestateServiceMethodResponse>(
    bsonBinarySerializer,
    restateServiceMethodResponseType,
  );

export const serializeRestateServiceMethodResponse = getBSONSerializer(
  bsonBinarySerializer,
  restateServiceMethodResponseType,
);

export const restateKeyedServiceType =
  typeOf<RestateKeyedService<string, any, any[]>>();

export const restateSagaType = typeOf<RestateSaga<string, any>>();

export const restateContextType = typeOf<RestateContext>();

export const restateKeyedContextType = typeOf<RestateKeyedContext>();

export const restateTerminalErrorType = typeOf<TerminalError>();

export const serializeRestateTerminalErrorType = getBSONSerializer(
  bsonBinarySerializer,
  restateTerminalErrorType,
);

export const deserializeRestateTerminalErrorType =
  getBSONDeserializer<TerminalError>(
    bsonBinarySerializer,
    restateTerminalErrorType,
  );

export const restateSagaContextType = typeOf<RestateSagaContext>();

export const SCOPE = 'restate';
