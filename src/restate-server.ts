import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap } from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import { assert, integer, PositiveNoZero } from '@deepkit/type';

import { Service, Services } from './services';
import { RestateServiceMethodMetadata } from './decorator';
import { RestateConfig } from './restate.module';
import {
  assertArgs,
  decodeRpcResponse,
  encodeRpcRequest,
  encodeRpcResponse,
  getRestateServiceName,
} from './utils';
import {
  CustomContext,
  RestateServiceMethodCall,
  RestateContext,
  RestateKeyedContext,
  SCOPE,
  restateKeyedContextToken,
  restateContextToken,
  RestateClientCallOptions,
  RestateRpcRequest,
  RestateRpcResponse,
} from './types';

export class RestateServer {
  readonly endpoint = restate.endpoint();

  constructor(
    private readonly config: RestateConfig,
    private readonly services: Services,
    private readonly injectorContext: InjectorContext,
  ) {}

  createContext(
    ctx: restate.Context | restate.KeyedContext,
  ): RestateContext | RestateKeyedContext {
    return Object.assign(ctx, <CustomContext>{
      send: async (
        { service, method, data, options: { keyed } }: RestateServiceMethodCall,
        { key }: RestateClientCallOptions = {},
      ): Promise<void> => {
        assertArgs({ keyed }, { key });

        await (ctx as any).invokeOneWay(
          service,
          method,
          encodeRpcRequest(data, key),
          0,
        );
      },
      sendDelayed: async (
        { service, method, data, options: { keyed } }: RestateServiceMethodCall,
        ms: number,
        { key }: RestateClientCallOptions = {},
      ): Promise<void> => {
        assert<integer & PositiveNoZero>(ms);
        assertArgs({ keyed }, { key });

        await (ctx as any).invokeOneWay(
          service,
          method,
          encodeRpcRequest(data, key),
          ms,
        );
      },
      rpc: async <T>(
        {
          service,
          method,
          data,
          deserializeReturn,
          options: { keyed },
        }: RestateServiceMethodCall,
        { key }: RestateClientCallOptions = {},
      ): Promise<T> => {
        assertArgs({ keyed }, { key });
        return (ctx as any)
          .invoke(service, method, encodeRpcRequest(data, key))
          .transform((response: Uint8Array) =>
            deserializeReturn(decodeRpcResponse(response)),
          );
      },
    });
  }

  createScopedInjector(): InjectorContext {
    return this.injectorContext.createChildScope(SCOPE);
  }

  createUnKeyedRouter({
    controller,
    module,
    metadata,
  }: Service<unknown>): restate.UnKeyedRouter<unknown> {
    return [...metadata.methods].reduce(
      (routes, method) => ({
        ...routes,
        [method.name]: async (
          _ctx: restate.Context,
          data: RestateRpcRequest,
        ): Promise<RestateRpcResponse> => {
          const injector = this.createScopedInjector();

          const ctx = this.createContext(_ctx);
          injector.set(restateContextToken, ctx, module);

          const instance = injector.get(controller, module);
          return await this.callServiceMethod(instance, method, data);
        },
      }),
      {} as restate.UnKeyedRouter<unknown>,
    );
  }

  createKeyedRouter({
    controller,
    module,
    metadata,
  }: Service<unknown>): restate.KeyedRouter<unknown> {
    return [...metadata.methods].reduce(
      (routes, method) => ({
        ...routes,
        [method.name]: async (
          _ctx: restate.KeyedContext,
          key: string,
          data: RestateRpcRequest,
        ): Promise<RestateRpcResponse> => {
          const injector = this.createScopedInjector();

          const ctx = this.createContext(_ctx);
          Object.assign(ctx, { key });

          injector.set(restateKeyedContextToken, ctx, module);

          const instance = injector.get(controller, module);
          return await this.callServiceMethod(instance, method, data);
        },
      }),
      {} as restate.KeyedRouter<unknown>,
    );
  }

  async callServiceMethod(
    instance: any,
    method: RestateServiceMethodMetadata,
    data: RestateRpcRequest,
  ): Promise<RestateRpcResponse> {
    const args = method.deserializeArgs(new Uint8Array(data));
    const result = await instance[method.name].bind(instance)(...args);
    return encodeRpcResponse(method.serializeReturn(result));
  }

  @eventDispatcher.listen(onServerMainBootstrap)
  async listen() {
    for (const service of this.services) {
      const serviceName = getRestateServiceName(service.metadata.type);

      if (service.metadata.keyed) {
        const router = this.createKeyedRouter(service);
        this.endpoint.bindKeyedRouter(serviceName, router);
      } else {
        const router = this.createUnKeyedRouter(service);
        this.endpoint.bindRouter(serviceName, router);
      }
    }

    await this.endpoint.listen(this.config.port);
  }
}
