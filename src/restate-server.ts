import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap } from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import { assert, integer, PositiveNoZero } from '@deepkit/type';

import { Service, Services } from './services';
import { RestateServiceMethodMetadata } from './decorator';
import { RestateConfig } from './restate.module';
import { assertArgs, getRestateServiceName } from './utils';
import {
  RestateApiInvocation,
  CustomContext,
  RestateServiceMethodCall,
  RestateContext,
  RestateKeyedContext,
  SCOPE,
  restateKeyedContextToken,
  restateContextToken,
  RestateClientCallOptions,
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
        { service, method, args, options: { keyed } }: RestateServiceMethodCall,
        { key }: RestateClientCallOptions = {},
      ): Promise<RestateApiInvocation> => {
        assertArgs({ keyed }, { key });
        const client = ctx.send({ path: service });
        return keyed
          ? await (client as any)[method].bind(client)(key, ...args)
          : await (client as any)[method].bind(client)(...args);
      },
      sendDelayed: async (
        { service, method, args, options: { keyed } }: RestateServiceMethodCall,
        ms: number,
        { key }: RestateClientCallOptions = {},
      ): Promise<RestateApiInvocation> => {
        assert<integer & PositiveNoZero>(ms);
        assertArgs({ keyed }, { key });
        const client = ctx.sendDelayed({ path: service }, ms);
        return keyed
          ? await (client as any)[method].bind(client)(key, ...args)
          : await (client as any)[method].bind(client)(...args);
      },
      rpc: async <T>(
        {
          service,
          method,
          args,
          deserializeReturn,
          options: { keyed },
        }: RestateServiceMethodCall,
        { key }: RestateClientCallOptions = {},
      ): Promise<T> => {
        assertArgs({ keyed }, { key });
        const client = ctx.rpc({ path: service });
        const result = keyed
          ? await (client as any)[method].bind(client)(key, ...args)
          : await (client as any)[method].bind(client)(...args);
        return deserializeReturn(result, { loosely: false });
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
          args: readonly unknown[],
        ) => {
          const injector = this.createScopedInjector();

          const ctx = this.createContext(_ctx);
          injector.set(restateContextToken, ctx, module);

          const instance = injector.get(controller, module);
          return await this.callServiceMethod(instance, method, args);
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
          args: readonly unknown[],
        ) => {
          const injector = this.createScopedInjector();

          const ctx = this.createContext(_ctx);
          Object.assign(ctx, { key });

          injector.set(restateKeyedContextToken, ctx, module);

          const instance = injector.get(controller, module);
          return await this.callServiceMethod(instance, method, args);
        },
      }),
      {} as restate.KeyedRouter<unknown>,
    );
  }

  async callServiceMethod<T>(
    instance: any,
    method: RestateServiceMethodMetadata,
    _args: readonly unknown[],
  ): Promise<T> {
    const args = method.deserializeArgs(_args, { loosely: false });
    const result = await instance[method.name].bind(instance)(...args);
    return method.serializeReturn(result);
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
