import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrapDone } from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import { hasTypeInformation, reflect, uint8 } from '@deepkit/type';

import { SagaManager } from './saga/saga-manager.js';
import { SAGA_STATE_KEY } from './saga/saga-instance.js';
import { InjectorService, InjectorServices } from './services.js';
import { InjectorObject, InjectorObjects } from './objects.js';
import { InjectorSagas } from './sagas.js';
import { RestateClassMetadata, RestateHandlerMetadata } from './decorator.js';
import { RestateConfig } from './restate.module.js';
import { decodeRestateServiceMethodResponse, encodeRpcRequest, encodeRpcResponse } from './utils.js';
import {
  RestateObjectContext,
  restateObjectContextType,
  RestateRpcRequest,
  RestateRpcResponse,
  RestateSagaContext,
  restateSagaContextType,
  RestateServiceContext,
  restateServiceContextType,
  SCOPE,
} from './types.js';

export class RestateServer {
  readonly endpoint = restate.endpoint();

  constructor(
    private readonly config: RestateConfig,
    private readonly services: InjectorServices,
    private readonly objects: InjectorObjects,
    private readonly sagas: InjectorSagas,
    private readonly injectorContext: InjectorContext,
  ) {}

  @eventDispatcher.listen(onServerMainBootstrapDone)
  async listen() {
    for (const object of this.objects) {
      const handlers = this.createObjectHandlers(object);
      this.endpoint.bind(
        restate.object({ name: object.metadata.name, handlers }),
      );
    }

    for (const service of this.services) {
      const handlers = this.createServiceHandlers(service);
      this.endpoint.bind(
        restate.service({ name: service.metadata.name, handlers }),
      );
    }

    for (const saga of this.sagas) {
      this.endpoint.bind(
        restate.workflow({
          name: saga.metadata.name,
          handlers: {
            run: async (
              _ctx: restate.WorkflowContext,
              { request }: { readonly request: RestateRpcRequest },
            ) => {
              const injector = this.createScopedInjector();
              const ctx = this.createSagaContext(_ctx);
              injector.set(restateSagaContextType, ctx);
              const restateSaga = injector.get(saga.classType, saga.module);
              const sagaManager = new SagaManager(
                ctx,
                restateSaga,
                saga.metadata,
              );
              const data = saga.metadata.deserializeData(
                new Uint8Array(request),
              );
              await sagaManager.start(data);
            },
            state: async (ctx: restate.WorkflowSharedContext) => {
              return await ctx.get<readonly uint8[]>(SAGA_STATE_KEY);
            },
          },
        }),
      );
    }

    await this.endpoint.listen(this.config.port);
  }

  private createScopedInjector(): InjectorContext {
    return this.injectorContext.createChildScope(SCOPE);
  }

  private createContext<
    T extends RestateObjectContext | RestateSagaContext | RestateServiceContext,
  >(
    ctx: restate.ObjectContext | restate.WorkflowContext | restate.Context,
    extra?: Partial<T>,
  ): T {
    return Object.assign(ctx, {
      serviceClient: undefined,
      serviceSendClient: undefined,
      objectSendClient: undefined,
      objectClient: undefined,
      workflowClient: undefined,
      workflowSendClient: undefined,
      send: async (...args: readonly any[]): Promise<void> => {
        const [key, { service, method, data }, options] =
          args.length === 1 ? [undefined, ...args] : args;

        try {
          await (ctx as any).invokeOneWay(
            service,
            method,
            encodeRpcRequest(data),
            options?.delay,
            key,
          );
        } catch (e) {
          (ctx as any).stateMachine.handleDanglingPromiseError(e);
        }
      },
      rpc: async <T>(...args: readonly any[]): Promise<T> => {
        const [key, { service, method, data, deserializeReturn, entities }] =
          args.length === 1 ? [undefined, ...args] : args;

        return await (ctx as any)
          .invoke(service, method, encodeRpcRequest(data), key)
          .transform((response: RestateRpcResponse) =>
            decodeRestateServiceMethodResponse(
              response,
              deserializeReturn,
              entities,
            ),
          );
      },
      ...extra,
    });
  }

  private createObjectContext(ctx: restate.ObjectContext): RestateObjectContext {
    return this.createContext<RestateObjectContext>(ctx);
  }

  private createServiceContext(ctx: restate.Context): RestateServiceContext {
    return this.createContext<RestateServiceContext>(ctx);
  }

  private createSagaContext(ctx: restate.WorkflowContext): RestateSagaContext {
    return Object.assign(this.createContext<RestateSagaContext>(ctx), { send: undefined, rpc: undefined });
  }

  private createServiceHandlers({
    classType,
    module,
    metadata,
  }: InjectorService<unknown>) {
    return [...metadata.handlers].reduce(
      (routes, handler) => ({
        ...routes,
        [handler.name]: async (
          _ctx: restate.Context,
          data: RestateRpcRequest,
        ): Promise<RestateRpcResponse> => {
          const injector = this.createScopedInjector();
          const ctx = this.createServiceContext(_ctx);
          injector.set(restateServiceContextType, ctx, module);
          const instance = injector.get(classType, module);
          return await this.callHandler(instance, metadata, handler, data);
        },
      }),
      {},
    );
  }

  private createObjectHandlers({
    classType,
    module,
    metadata,
  }: InjectorObject<unknown>) {
    return [...metadata.handlers].reduce(
      (handlers, handler) => {
        let fn = async (
          _ctx: restate.ObjectContext,
          data: RestateRpcRequest,
        ): Promise<RestateRpcResponse> => {
          const injector = this.createScopedInjector();
          const ctx = this.createObjectContext(_ctx);
          injector.set(restateObjectContextType, ctx, module);
          const instance = injector.get(classType, module);
          return await this.callHandler(instance, metadata, handler, data);
        }

        if (handler.shared) {
          fn = restate.handlers.object.shared(fn);
        } else if (handler.exclusive) {
          fn = restate.handlers.object.exclusive(fn);
        }

        return {
          ...handlers,
          [handler.name]: fn,
        };
      },
      {},
    );
  }

  private async callHandler(
    instance: any,
    clazz: RestateClassMetadata,
    handler: RestateHandlerMetadata,
    request: RestateRpcRequest,
  ): Promise<RestateRpcResponse> {
    try {
      const args = handler.deserializeArgs(new Uint8Array(request));
      const result = await instance[handler.name].bind(instance)(...args);
      return encodeRpcResponse({
        success: true,
        data: handler.serializeReturn(result),
        typeName: handler.returnType.typeName!,
      });
    } catch (err: any) {
      if (hasTypeInformation(err.constructor)) {
        const entityName = reflect(err.constructor).typeName!;
        const entity = clazz.entities.get(entityName);
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
          // errorCode: restate.RestateErrorCodes.INTERNAL,
        });
      }
      throw err;
    }
  }
}