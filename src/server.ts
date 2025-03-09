import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap } from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import {
  NoTypeReceived,
  ReceiveType,
  ReflectionKind,
  hasTypeInformation,
} from '@deepkit/type';
import * as restate from '@restatedev/restate-sdk';

import { RestateAdminClient } from './admin-client.js';
import { RestateConfig } from './config.js';
import {
  RestateAwakeable,
  RestateContextStorage,
  RestateObjectContext,
  RestateSagaContext,
  RestateServiceContext,
  restateObjectContextType,
  restateSagaContextType,
  restateServiceContextType,
} from './context.js';
import { RestateHandlerMetadata } from './decorator.js';
import { RestateEventsSubscriber } from './event/subscriber.js';
import { Subscriptions } from './event/types.js';
import { RestateModule } from './module.js';
import { ModuleObject, ModuleSaga, ModuleService } from './providers.js';
import { SAGA_STATE_KEY } from './saga/saga-instance.js';
import { SagaManager } from './saga/saga-manager.js';
import {
  createBSONSerde,
  deserializeRestateServiceMethodResponse,
  serializeResponseData,
  serializeRestateHandlerResponse,
} from './serde.js';
import { RestateRunAction, SCOPE } from './types.js';

const DEFAULT_HANDLER_OPTS = {
  contentType: 'application/octet-stream',
  accept: 'application/octet-stream',
} as const;

export class RestateServer {
  readonly endpoint = restate.endpoint();

  constructor(
    private readonly config: RestateConfig,
    private readonly module: RestateModule,
    private readonly injectorContext: InjectorContext,
    private readonly contextStorage: RestateContextStorage,
  ) {}

  @eventDispatcher.listen(onServerMainBootstrap)
  async listen() {
    const config = this.config.server!;

    for (const object of this.module.objects) {
      const handlers = this.createObjectHandlers(object);
      this.endpoint.bind(
        restate.object({ name: object.metadata.name, handlers }),
      );
    }

    for (const service of this.module.services) {
      const handlers = this.createServiceHandlers(service);
      this.endpoint.bind(
        restate.service({ name: service.metadata.name, handlers }),
      );
    }

    for (const saga of this.module.sagas) {
      const handlers = this.createSagaHandlers(saga);
      this.endpoint.bind(
        restate.workflow({ name: saga.metadata.name, handlers }),
      );
    }

    await this.endpoint.listen(config.port);

    if (this.config.admin?.autoDeploy) {
      const admin = this.injectorContext.get(RestateAdminClient);
      await admin.deployments.create(`${config.host}:${config.port}`);
    }

    if (this.config.kafka) {
      if (!this.config.admin) {
        throw new Error('Restate admin config is missing for Kafka');
      }
      // TODO: filter out handlers by existing subscriptions
      await Promise.all([
        this.addKafkaHandlerSubscriptions('object', [...this.module.objects]),
        this.addKafkaHandlerSubscriptions('service', [...this.module.services]),
      ]);
    }

    if (this.config.event) {
      await this.addEventHandlerSubscriptions();
    }
  }

  private async addEventHandlerSubscriptions() {
    const events = this.injectorContext.get(RestateEventsSubscriber);
    let subscriptions: Subscriptions = [];
    for (const { metadata } of [
      ...this.module.services,
      ...this.module.objects,
    ]) {
      for (const handler of metadata.handlers) {
        if (handler.event) {
          subscriptions = [
            ...subscriptions,
            {
              service: metadata.name,
              method: handler.name,
              typeName: handler.event.type.typeName!,
            },
          ];
        }
      }
    }
    if (subscriptions.length) {
      // TODO: call this as part of cli
      await events.subscribe(subscriptions);
    }
  }

  private createScopedInjector(): InjectorContext {
    return this.injectorContext.createChildScope(SCOPE);
  }

  private createContext<
    T extends RestateObjectContext | RestateSagaContext | RestateServiceContext,
  >(ctx: restate.ObjectContext | restate.WorkflowContext | restate.Context): T {
    const _resolveAwakeable = ctx.resolveAwakeable.bind(ctx);
    const _awakeable = ctx.awakeable.bind(ctx);
    const _run = ctx.run.bind(ctx);

    const newCtx = Object.assign(ctx, {
      serviceClient: undefined,
      serviceSendClient: undefined,
      objectSendClient: undefined,
      objectClient: undefined,
      workflowClient: undefined,
      workflowSendClient: undefined,
      resolveAwakeable<T>(id: string, payload?: T, type?: ReceiveType<T>) {
        const serde = createBSONSerde(type);
        _resolveAwakeable(id, payload, serde);
      },
      awakeable<T>(type?: ReceiveType<T>): RestateAwakeable<T> {
        const serde = createBSONSerde<T>(type);
        return _awakeable<T>(serde) as RestateAwakeable<T>;
      },
      async run<T = void>(
        name: string,
        action: RestateRunAction<T>,
        type?: ReceiveType<T>,
      ): Promise<T> {
        if (!type) {
          await _run(name, action);
          return void 0 as T;
        }

        const serde = createBSONSerde<T>(type);
        return (await _run(name, action, {
          serde,
        })) as T;
      },
      send(...args: readonly any[]): void {
        const [key, { service, method, data }, options] =
          args.length === 1 ? [undefined, ...args] : args;

        ctx.genericSend({
          service,
          method,
          parameter: data,
          delay: options?.delay,
          key,
        });
      },
      async rpc<T>(...args: readonly any[]): Promise<T> {
        const [key, { service, method, data, deserializeReturn, entities }] =
          args.length === 1 ? [undefined, ...args] : args;

        const response = await ctx.genericCall({
          service,
          method,
          parameter: data,
          key,
          outputSerde: restate.serde.binary,
        });

        return deserializeRestateServiceMethodResponse(
          response,
          deserializeReturn,
          entities,
        );
      },
    }) as T;

    if ('key' in ctx) {
      const _set = ctx.set.bind(ctx);
      const _get = ctx.get.bind(ctx);

      Object.assign(newCtx, {
        set<T>(name: string, value: T, type?: ReceiveType<T>) {
          const serde = createBSONSerde<T>(type);
          _set(name, value, serde);
        },
        async get<T>(name: string, type?: ReceiveType<T>): Promise<T | null> {
          const serde = createBSONSerde<T>(type);
          return await _get<T>(name, serde);
        },
      });
    }

    return newCtx;
  }

  private createObjectContext(
    ctx: restate.ObjectContext,
  ): RestateObjectContext {
    return this.createContext<RestateObjectContext>(ctx);
  }

  private createServiceContext(ctx: restate.Context): RestateServiceContext {
    return this.createContext<RestateServiceContext>(ctx);
  }

  private createSagaContext(
    ctx: restate.WorkflowContext | restate.WorkflowSharedContext,
  ): RestateSagaContext {
    return Object.assign(this.createContext<RestateSagaContext>(ctx), {
      send: undefined,
      rpc: undefined,
    });
  }

  private async addKafkaHandlerSubscriptions(
    protocol: 'object' | 'service',
    classes: ModuleObject<unknown>[] | ModuleService<unknown>[],
  ) {
    const admin = this.injectorContext.get(RestateAdminClient);
    const classesMetadata = classes.map(({ metadata }) => ({
      name: metadata.name,
      handlers: [...metadata.handlers],
    }));
    await Promise.all(
      classesMetadata.flatMap(metadata => {
        return metadata.handlers.map(async handler => {
          await admin.kafka.subscriptions.create({
            source: `kafka://${this.config.kafka!.clusterName}/${handler.kafka!.topic}`,
            // TODO: figure out if protocol "object://" is needed for objects
            sink: `${protocol}://${metadata.name}/${handler.name}`,
            options: handler.kafka?.options,
          });
        });
      }),
    );
  }

  private createServiceHandlers({
    classType,
    module,
    metadata,
  }: ModuleService<unknown>) {
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
            injector.set(restateServiceContextType, ctx);
            const instance = injector.get(classType, module);
            return await this.contextStorage.run(ctx, () =>
              this.callHandler(instance, handler, data),
            );
          },
        ),
      }),
      {},
    );
  }

  private createSagaHandlers({ module, classType, metadata }: ModuleSaga) {
    return {
      run: restate.handlers.workflow.workflow(
        DEFAULT_HANDLER_OPTS,
        async (rsCtx: restate.WorkflowContext, request: Uint8Array) => {
          const injector = this.createScopedInjector();
          const ctx = this.createSagaContext(rsCtx);
          injector.set(restateSagaContextType, ctx);
          const restateSaga = injector.get(classType, module);
          const sagaManager = new SagaManager(ctx, restateSaga, metadata);
          const data = metadata.deserializeData(request);
          await this.contextStorage.run(ctx, async () => {
            await sagaManager.start(data);
            await sagaManager.waitForCompletion();
          });
          return new Uint8Array();
        },
      ),
      state: restate.handlers.workflow.shared(
        DEFAULT_HANDLER_OPTS,
        async (ctx: restate.WorkflowSharedContext) => {
          const data = await ctx.get<Uint8Array>(
            SAGA_STATE_KEY,
            restate.serde.binary,
          );
          if (!data) {
            throw new Error('Missing saga state');
          }
          return data;
        },
      ),
    };
  }

  private createObjectHandlers({
    classType,
    module,
    metadata,
  }: ModuleObject<unknown>) {
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
            injector.set(restateObjectContextType, ctx);
            const instance = injector.get(classType, module);
            return await this.contextStorage.run(ctx, () =>
              this.callHandler(instance, handler, data),
            );
          },
        ),
      }),
      {},
    );
  }

  private async callHandler(
    instance: any,
    handler: RestateHandlerMetadata,
    data: Uint8Array,
  ): Promise<Uint8Array> {
    try {
      const args = handler.deserializeArgs(data);
      const result = await instance[handler.name].bind(instance)(...args);
      return serializeRestateHandlerResponse({
        success: true,
        data:
          handler.returnType.kind !== ReflectionKind.void &&
          handler.returnType.kind !== ReflectionKind.undefined
            ? handler.serializeReturn(result)
            : new Uint8Array(),
        typeName: handler.returnType.typeName,
      });
    } catch (error: any) {
      if (hasTypeInformation(error.constructor)) {
        return serializeRestateHandlerResponse({
          success: false,
          data: serializeResponseData(error, error.constructor),
          typeName: error.constructor.name,
        });
      }
      if (error instanceof TypeError || error instanceof NoTypeReceived) {
        throw new restate.TerminalError(error.message, {
          cause: error,
          errorCode: 500,
        });
      }
      throw error;
    }
  }
}
