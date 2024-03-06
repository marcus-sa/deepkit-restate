import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap } from '@deepkit/framework';
import { InjectorContext, InjectorModule } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import {
  deserialize,
  reflect,
  serialize,
  serializer,
  Type,
  TypeClass,
} from '@deepkit/type';
import assert from 'node:assert';

import { Service, Services } from './services';
import {
  restateClassDecorator,
  RestateServiceMetadata,
  RestateServiceMethodMetadata,
} from './decorator';
import { RestateConfig } from './restate.module';
import {
  createServiceProxy,
  getRestateServiceMetadata,
  getRestateServiceName,
  getRestateServiceDeps,
} from './utils';
import {
  CustomContext,
  RestateServiceMethodCall,
  restateKeyedContextType,
  restateContextType,
  RestateContext,
  RestateKeyedContext,
  SCOPE,
  RestateKeyedContextImpl,
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
      send: async ({ service, method, args }: RestateServiceMethodCall) => {
        const client = ctx.send({ path: service });
        await (client as any)[method].bind(client)(...args);
      },
      sendDelayed: async (
        { service, method, args }: RestateServiceMethodCall,
        ms: number,
      ) => {
        const client = ctx.sendDelayed({ path: service }, ms);
        await (client as any)[method].bind(client)(...args);
      },
      rpc: async <T>({
        service,
        method,
        args,
        returnType,
      }: RestateServiceMethodCall): Promise<T> => {
        const client = ctx.rpc({ path: service });
        const result = await (client as any)[method].bind(client)(...args);
        return deserialize(
          result,
          undefined,
          serializer,
          undefined,
          returnType,
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
          args: readonly unknown[],
        ) => {
          const injector = this.createScopedInjector();

          const ctx = this.createContext(_ctx);
          injector.set(restateContextType, ctx, module);

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

          injector.set(restateKeyedContextType, ctx, module);

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
    args: readonly unknown[],
  ): Promise<T> {
    const result = await instance[method.name].bind(instance)(...args);
    return serialize(
      result,
      undefined,
      serializer,
      undefined,
      method.returnType,
    );
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
