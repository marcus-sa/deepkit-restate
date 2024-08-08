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
import { decodeRestateServiceMethodResponse } from './utils.js';
import {
  RestateObjectContext,
  restateObjectContextType,
  RestateSagaContext,
  restateSagaContextType,
  RestateServiceContext,
  restateServiceContextType,
  SCOPE,
  SendStatus,
  serializeRestateHandlerResponse,
} from './types.js';

const DEFAULT_HANDLER_OPTS = {
  contentType: 'application/octet-stream',
  accept: 'application/octet-stream',
} as const;

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
            run: restate.handlers.workflow.workflow(
              DEFAULT_HANDLER_OPTS,
              async (rsCtx: restate.WorkflowContext, request: Uint8Array) => {
                const injector = this.createScopedInjector();
                const ctx = this.createSagaContext(rsCtx);
                injector.set(restateSagaContextType, ctx);
                const restateSaga = injector.get(saga.classType, saga.module);
                const sagaManager = new SagaManager(
                  ctx,
                  restateSaga,
                  saga.metadata,
                );
                const data = saga.metadata.deserializeData(request);
                await sagaManager.start(data);
                return new Uint8Array();
              },
            ),
            state: restate.handlers.workflow.shared(
              DEFAULT_HANDLER_OPTS,
              async (ctx: restate.WorkflowSharedContext) => {
                const value = await ctx.get<readonly uint8[]>(SAGA_STATE_KEY);
                if (!value) {
                  throw new Error('Missing state');
                }
                return new Uint8Array(value);
              },
            ),
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
      send: async (...args: readonly any[]): Promise<SendStatus> => {
        const [key, { service, method, data }, options] =
          args.length === 1 ? [undefined, ...args] : args;

        try {
          return await (ctx as any).invokeOneWay(
            service,
            method,
            data,
            options?.delay,
            key,
          );
        } catch (e) {
          (ctx as any).stateMachine.handleDanglingPromiseError(e);
          throw e;
        }
      },
      rpc: async <T>(...args: readonly any[]): Promise<T> => {
        const [key, { service, method, data, deserializeReturn, entities }] =
          args.length === 1 ? [undefined, ...args] : args;

        return await (ctx as any).invoke(
          service,
          method,
          data,
          key,
          undefined,
          (response: Uint8Array) =>
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

  private createObjectContext(
    ctx: restate.ObjectContext,
  ): RestateObjectContext {
    return this.createContext<RestateObjectContext>(ctx);
  }

  private createServiceContext(ctx: restate.Context): RestateServiceContext {
    return this.createContext<RestateServiceContext>(ctx);
  }

  private createSagaContext(ctx: restate.WorkflowContext): RestateSagaContext {
    return Object.assign(this.createContext<RestateSagaContext>(ctx), {
      send: undefined,
      rpc: undefined,
    });
  }

  private createServiceHandlers({
    classType,
    module,
    metadata,
  }: InjectorService<unknown>) {
    return [...metadata.handlers].reduce(
      (handlers, handler) => ({
        ...handlers,
        [handler.name]: restate.handlers.handler(
          DEFAULT_HANDLER_OPTS,
          async (
            rsCtx: restate.Context,
            data: Uint8Array,
          ): Promise<Uint8Array> => {
            const injector = this.createScopedInjector();
            const ctx = this.createServiceContext(rsCtx);
            injector.set(restateServiceContextType, ctx, module);
            const instance = injector.get(classType, module);
            return await this.callHandler(instance, metadata, handler, data);
          },
        ),
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
      (handlers, handler) => ({
        ...handlers,
        [handler.name]: (handler.shared
          ? restate.handlers.object.shared
          : restate.handlers.object.exclusive)(
          DEFAULT_HANDLER_OPTS,
          // @ts-ignore
          async (
            rsCtx: restate.ObjectContext,
            data: Uint8Array,
          ): Promise<Uint8Array> => {
            const injector = this.createScopedInjector();
            const ctx = this.createObjectContext(rsCtx);
            injector.set(restateObjectContextType, ctx, module);
            const instance = injector.get(classType, module);
            return await this.callHandler(instance, metadata, handler, data);
          },
        ),
      }),
      {},
    );
  }

  private async callHandler(
    instance: any,
    clazz: RestateClassMetadata,
    handler: RestateHandlerMetadata,
    request: Uint8Array,
  ): Promise<Uint8Array> {
    try {
      const args = handler.deserializeArgs(request);
      const result = await instance[handler.name].bind(instance)(...args);
      return serializeRestateHandlerResponse({
        success: true,
        data: handler.serializeReturn(result),
        typeName: handler.returnType.typeName!,
      });
    } catch (err: any) {
      if (hasTypeInformation(err.constructor)) {
        const entityName = reflect(err.constructor).typeName!;
        const entity = clazz.entities.get(entityName);
        if (entity) {
          return serializeRestateHandlerResponse({
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
