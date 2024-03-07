import { SerializeFunction, Type, typeOf } from '@deepkit/type';
import { Context, KeyedContext } from '@restatedev/restate-sdk';
import { getContainerToken } from '@deepkit/injector';

export interface RestateApiInvocation {
  readonly id: string;
}

export interface RestateClientCallOptions {
  readonly key?: string | number;
}

export interface CustomContext {
  send(
    call: RestateServiceMethodCall,
    options?: RestateClientCallOptions,
  ): Promise<RestateApiInvocation>;
  send(
    call: RestateServiceMethodCall,
    options?: RestateClientCallOptions,
  ): Promise<RestateApiInvocation>;
  sendDelayed(
    call: RestateServiceMethodCall,
    ms: number,
    options?: RestateClientCallOptions,
  ): Promise<RestateApiInvocation>;
  rpc<R, A extends any[]>(call: RestateServiceMethodCall<R, A>): Promise<R>;
}

export interface RestateServiceMethodCall<R = never, A extends any[] = []> {
  readonly options: RestateServiceOptions;
  readonly service: string;
  readonly method: string;
  // Will be serialized
  readonly args: A;
  readonly deserializeReturn: SerializeFunction;
}

type RestateServiceMethod<F> = F extends (...args: infer P) => infer R
  ? (...args: P) => RestateServiceMethodCall<Awaited<R>, P>
  : never;

export interface RestateServiceOptions {
  readonly keyed?: boolean;
}

export type RestateService<
  N extends string,
  S,
  O extends RestateServiceOptions = {},
> = {
  [M in keyof S as S[M] extends never ? never : M]: RestateServiceMethod<S[M]>;
};

export type RestateContext = CustomContext &
  Omit<Context, 'rpc' | 'send' | 'sendDelayed'>;

export const restateContextType = typeOf<RestateContext>();

export const restateContextToken = getContainerToken(restateContextType);

export interface RestateKeyedContext
  extends CustomContext,
    Omit<KeyedContext, 'rpc' | 'send' | 'sendDelayed'> {
  readonly key: string;
}

export const restateKeyedContextType = typeOf<RestateKeyedContext>();

export const restateKeyedContextToken = getContainerToken(
  restateKeyedContextType,
);

export const restateServiceType = typeOf<RestateService<string, any>>();

export const SCOPE = 'restate';
