import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap } from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import { assert, integer, PositiveNoZero, typeSettings } from '@deepkit/type';

import { Service, Services } from './services';
import { Sagas, Saga } from './sagas';
import {
  RestateServiceMetadata,
  RestateServiceMethodMetadata,
} from './decorator';
import { RestateConfig } from './restate.module';
import {
  assertArgs,
  decodeRpcResponse,
  encodeRpcRequest,
  encodeRpcResponse,
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
import { isClass } from '@deepkit/core';

export class RestateServer {
  readonly endpoint = restate.endpoint();

  constructor(
    private readonly config: RestateConfig,
    private readonly services: Services,
    private readonly sagas: Sagas,
    private readonly injectorContext: InjectorContext,
  ) {}

  createContext(
    ctx: restate.Context | restate.KeyedContext,
  ): RestateContext | RestateKeyedContext {
    return Object.assign(ctx, <CustomContext>{
      send: async (
        { service, method, data, keyed }: RestateServiceMethodCall,
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
        { service, method, data, keyed }: RestateServiceMethodCall,
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
          keyed,
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

  createUnKeyedService({
    classType,
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

          const instance = injector.get(classType, module);
          return await this.callServiceMethod(instance, metadata, method, data);
        },
      }),
      {} as restate.UnKeyedRouter<unknown>,
    );
  }

  createKeyedService({
    classType,
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

          const instance = injector.get(classType, module);
          return await this.callServiceMethod(instance, metadata, method, data);
        },
      }),
      {} as restate.KeyedRouter<unknown>,
    );
  }

  async callServiceMethod(
    instance: any,
    service: RestateServiceMetadata,
    method: RestateServiceMethodMetadata,
    data: RestateRpcRequest,
  ): Promise<RestateRpcResponse> {
    try {
      const args = method.deserializeArgs(new Uint8Array(data));
      const result = await instance[method.name].bind(instance)(...args);
      return encodeRpcResponse(method.serializeReturn(result));
    } catch (err: any) {
      if (service.entities.has(err)) {
      }
      throw err;
    }
  }

  @eventDispatcher.listen(onServerMainBootstrap)
  async listen() {
    for (const service of this.services) {
      if (service.metadata.keyed) {
        const router = this.createKeyedService(service);
        this.endpoint.bindKeyedRouter(service.metadata.name, router);
      } else {
        const router = this.createUnKeyedService(service);
        this.endpoint.bindRouter(service.metadata.name, router);
      }
    }

    for (const saga of this.sagas) {
    }

    await this.endpoint.listen(this.config.port);
  }
}
