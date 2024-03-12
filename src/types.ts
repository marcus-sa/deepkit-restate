import { TypeClass, typeOf, uint8 } from '@deepkit/type';
import { Context, KeyedContext } from '@restatedev/restate-sdk';
import { getContainerToken } from '@deepkit/injector';
import { BSONDeserializer } from '@deepkit/bson';
import { ClassType } from '@deepkit/core';

export interface RestateApiInvocation {
  readonly id: string;
}

export interface RestateClientCallOptions {
  readonly key?: string;
  readonly timeout?: number;
}

export interface CustomContext {
  send(
    call: RestateServiceMethodCall,
    options?: RestateClientCallOptions,
  ): Promise<void>;
  sendDelayed(
    call: RestateServiceMethodCall,
    ms: number,
    options?: RestateClientCallOptions,
  ): Promise<void>;
  rpc<R, A extends any[]>(call: RestateServiceMethodCall<R, A>): Promise<R>;
}

export interface RestateServiceMethodCall<R = any, A extends any[] = []> {
  readonly keyed: boolean;
  readonly entities: Set<ClassType>;
  readonly service: string;
  readonly method: string;
  readonly data: RestateRpcRequest;
  readonly deserializeReturn: BSONDeserializer<R>;
}

export type RestateRpcRequest = readonly uint8[];

export type RestateRpcResponse = readonly uint8[];

type RestateServiceMethod<F> = F extends (...args: infer P) => infer R
  ? (...args: P) => RestateServiceMethodCall<Awaited<R>, P>
  : never;

export interface RestateServiceOptions {
  readonly keyed: boolean;
}

export type RestateService<
  Name extends string,
  S,
  Entities extends any = [],
> = {
  [M in keyof S as S[M] extends never ? never : M]: RestateServiceMethod<S[M]>;
};

export type RestateKeyedService<
  Name extends string,
  S,
  Entities extends any = [],
> = {
  [M in keyof S as S[M] extends never ? never : M]: RestateServiceMethod<S[M]>;
};

export type RestateSaga<
  Name extends string,
  Data,
  Entities extends any[] = [],
> = never;

export type RestateContext = CustomContext &
  Omit<Context, 'rpc' | 'send' | 'sendDelayed'>;

export interface RestateKeyedContext
  extends CustomContext,
    Omit<KeyedContext, 'rpc' | 'send' | 'sendDelayed'> {
  readonly key: string;
}

export type RestateSagaContext = RestateKeyedContext;

export const restateServiceType = typeOf<RestateService<string, any, any[]>>();

export const restateKeyedServiceType =
  typeOf<RestateKeyedService<string, any, any[]>>();

export const restateServiceMethodCallType =
  typeOf<RestateServiceMethodCall<any, any[]>>();

export const restateSagaType = typeOf<RestateSaga<string, any>>();

export const restateContextType = typeOf<RestateContext>();

export const restateKeyedContextType = typeOf<RestateKeyedContext>();

export const restateSagaContextType = typeOf<RestateSagaContext>();

export const restateContextToken = getContainerToken(restateContextType);

export const restateKeyedContextToken = getContainerToken(
  restateKeyedContextType,
);

export const restateSagaContextToken = getContainerToken(
  restateSagaContextType,
);

export const SCOPE = 'restate';
