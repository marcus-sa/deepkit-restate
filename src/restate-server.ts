import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap } from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import {
  deserializeBSON,
  getBSONDeserializer,
  getBSONSerializer,
  serializeBSON,
} from '@deepkit/bson';
import {
  hasTypeInformation,
  ReceiveType,
  reflect,
  ReflectionKind,
  resolveReceiveType,
  uint8,
} from '@deepkit/type';

import { SagaManager } from './saga/saga-manager.js';
import { SAGA_STATE_KEY } from './saga/saga-instance.js';
import { RestateEventsSubscriber } from './event/subscriber.js';
import { Subscriptions } from './event/types.js';
import { InjectorService, InjectorServices } from './services.js';
import { InjectorObject, InjectorObjects } from './objects.js';
import { InjectorSaga, InjectorSagas } from './sagas.js';
import { RestateClassMetadata, RestateHandlerMetadata } from './decorator.js';
import { RestateConfig } from './config.js';
import { decodeRestateServiceMethodResponse, invokeOneWay } from './utils.js';
import { RestateAdminClient } from './restate-admin-client.js';
import { RestateContextStorage } from './restate-context-storage.js';
import { serializeRestateHandlerResponse } from './serializer.js';
import {
  RestateAwakeable,
  RestateObjectContext,
  restateObjectContextType,
  RestateRunAction,
  RestateSagaContext,
  restateSagaContextType,
  RestateServiceContext,
  restateServiceContextType,
  SCOPE,
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
    private readonly contextStorage: RestateContextStorage,
  ) {}

  @eventDispatcher.listen(onServerMainBootstrap)
  async listen() {
    const config = this.config.server!;

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
        this.addKafkaHandlerSubscriptions('object', [...this.objects]),
        this.addKafkaHandlerSubscriptions('service', [...this.services]),
      ]);
    }

    if (this.config.event) {
      await this.addEventHandlerSubscriptions();
    }
  }

  private async addEventHandlerSubscriptions() {
    const events = this.injectorContext.get(RestateEventsSubscriber);
    let subscriptions: Subscriptions = [];
    for (const { metadata } of [...this.services, ...this.objects]) {
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
    return {
      serviceClient: undefined,
      serviceSendClient: undefined,
      objectSendClient: undefined,
      objectClient: undefined,
      workflowClient: undefined,
      workflowSendClient: undefined,
      original: ctx,
      set: 'set' in ctx ? ctx.set.bind(ctx) : undefined,
      get: 'get' in ctx ? ctx.get.bind(ctx) : undefined,
      resolveAwakeable<T>(id: string, payload?: T, type?: ReceiveType<T>) {
        type = resolveReceiveType(type);
        const serialize = getBSONSerializer(undefined, type);
        ctx.resolveAwakeable(id, Array.from(serialize(payload)));
      },
      awakeable<T>(type?: ReceiveType<T>): RestateAwakeable<T> {
        type = resolveReceiveType(type);
        const awakeable = ctx.awakeable<readonly uint8[]>();
        const deserialize = getBSONDeserializer<T>(undefined, type);
        const promise = awakeable.promise.then(bytes =>
          deserialize(new Uint8Array(bytes)),
        );
        return {
          id: awakeable.id,
          promise,
        } as RestateAwakeable<T>;
      },
      // TypeError: Cannot read properties of undefined (reading 'kind')
      //   at ReflectionTransformer.getArrowFunctionΩPropertyAccessIdentifier
      // run: async <T>(action: RestateRunAction<T>, type?: ReceiveType<T>): Promise<T> => {
      async run<T = void>(
        action: RestateRunAction<T>,
        type?: ReceiveType<T>,
      ): Promise<T> {
        try {
          type = resolveReceiveType(type);
        } catch {}
        // TODO: https://github.com/restatedev/sdk-typescript/issues/410
        const result = await ctx.run(async () => {
          const result = await action();
          if (!type || !result) return;
          return serializeBSON(result, undefined, type);
        });
        // @ts-ignore
        if (!type || !result) return;
        return deserializeBSON(result, undefined, undefined, type);
      },
      send: (...args: readonly any[]): restate.CombineablePromise<void> => {
        const [key, { service, method, data }, options] =
          args.length === 1 ? [undefined, ...args] : args;

        return invokeOneWay(ctx, {
          service,
          method,
          data,
          delay: options?.delay,
          key,
        });
      },
      rpc: <T>(...args: readonly any[]): restate.CombineablePromise<T> => {
        const [key, { service, method, data, deserializeReturn, entities }] =
          args.length === 1 ? [undefined, ...args] : args;

        return (ctx as any).invoke(
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
    } as unknown as T;
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

  private async addKafkaHandlerSubscriptions(
    protocol: 'object' | 'service',
    classes: InjectorObject<unknown>[] | InjectorService<unknown>[],
  ) {
    const admin = this.injectorContext.get(RestateAdminClient);
    const classesMetadata = classes.map(({ metadata }) => ({
      name: metadata.name,
      handlers: [...metadata.handlers],
    }));
    await Promise.all(
      classesMetadata.flatMap(metadata => {
        return metadata.handlers.map(async handler => {
          const url = `${this.config.admin!.url}/subscriptions`;

          await admin.kafka.subscriptions.create({
            source: `kafka://${this.config.kafka!.clusterName}/${handler.kafka!.topic}`,
            // TODO: figure out if protocol "object://" is needed for objects?
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
            injector.set(restateServiceContextType, ctx);
            const instance = injector.get(classType, module);
            return await this.contextStorage.run(ctx, () =>
              this.callHandler(instance, metadata, handler, data),
            );
          },
        ),
      }),
      {},
    );
  }

  private createSagaHandlers({ module, classType, metadata }: InjectorSaga) {
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
          await this.contextStorage.run(ctx, () => sagaManager.start(data));
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
    };
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
            injector.set(restateObjectContextType, ctx);
            const instance = injector.get(classType, module);
            return await this.contextStorage.run(ctx, () =>
              this.callHandler(instance, metadata, handler, data),
            );
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
        data:
          handler.returnType.kind !== ReflectionKind.void &&
          handler.returnType.kind !== ReflectionKind.undefined
            ? handler.serializeReturn(result)
            : new Uint8Array(),
        typeName: handler.returnType.typeName,
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
