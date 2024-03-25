import { eventDispatcher } from '@deepkit/event';
import { RpcResponse } from '@restatedev/restate-sdk/dist/generated/proto/dynrpc.js';
import { onServerMainBootstrapDone } from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import {
  assert,
  hasTypeInformation,
  integer,
  PositiveNoZero,
  reflect,
  uint8,
} from '@deepkit/type';

import { SagaManager } from './saga/saga-manager.js';
import { SAGA_STATE_KEY } from './saga/saga-instance.js';
import { Service, Services } from './services.js';
import { Sagas } from './sagas.js';
import {
  RestateServiceMetadata,
  RestateServiceMethodMetadata,
} from './decorator.js';
import { RestateConfig } from './restate.module.js';
import {
  assertArgs,
  decodeRestateServiceMethodResponse,
  encodeRpcRequest,
  encodeRpcResponse,
} from './utils.js';
import {
  CustomContext,
  RestateServiceMethodRequest,
  RestateContext,
  RestateKeyedContext,
  SCOPE,
  RestateClientCallOptions,
  RestateRpcRequest,
  RestateRpcResponse,
  RestateSagaContext,
  restateContextType,
  restateKeyedContextType,
  restateSagaContextType,
} from './types.js';

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
  ): RestateContext | RestateKeyedContext | RestateSagaContext {
    return Object.assign(ctx, <CustomContext>{
      send: async (
        { service, method, data, keyed }: RestateServiceMethodRequest,
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
        { service, method, data, keyed }: RestateServiceMethodRequest,
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
          entities,
        }: RestateServiceMethodRequest,
        { key }: RestateClientCallOptions = {},
      ): Promise<T> => {
        assertArgs({ keyed }, { key });
        return (ctx as any)
          .invoke(service, method, encodeRpcRequest(data, key))
          .transform((response: Uint8Array) =>
            decodeRestateServiceMethodResponse(
              new Uint8Array(RpcResponse.decode(response).response),
              deserializeReturn,
              entities,
            ),
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
          injector.set(restateContextType, ctx, module);

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

          injector.set(restateKeyedContextType, ctx, module);

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
      return encodeRpcResponse({
        success: true,
        data: method.serializeReturn(result),
        typeName: method.returnType.typeName!,
      });
    } catch (err: any) {
      if (hasTypeInformation(err.constructor)) {
        const entityName = reflect(err.constructor).typeName!;
        const entity = service.entities.get(entityName);
        if (entity) {
          return encodeRpcResponse({
            success: false,
            data: entity.serialize(err),
            typeName: entityName,
          });
        }
      }
      if (err instanceof TypeError) {
        throw new restate.TerminalError(err.message, {
          cause: TypeError.name,
          errorCode: restate.ErrorCodes.INTERNAL,
        });
      }
      throw err;
    }
  }

  @eventDispatcher.listen(onServerMainBootstrapDone)
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
      this.endpoint.bind(
        restate.workflow.workflow(saga.metadata.name, {
          run: async (
            ctx: RestateSagaContext,
            { request }: { readonly request: RestateRpcRequest },
          ) => {
            const injector = this.createScopedInjector();
            injector.set(restateSagaContextType, ctx);
            const restateSaga = injector.get(saga.classType, saga.module);
            const sagaManager = new SagaManager(
              ctx,
              restateSaga,
              saga.metadata,
            );
            const data = saga.metadata.deserializeData(new Uint8Array(request));
            await sagaManager.start(data);
          },
          state: async (ctx: restate.workflow.SharedWfContext) => {
            return await ctx.get<readonly uint8[]>(SAGA_STATE_KEY);
          },
        }),
      );
    }

    await this.endpoint.listen(this.config.port);
  }
}
