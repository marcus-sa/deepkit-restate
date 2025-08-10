import { eventDispatcher } from '@deepkit/event';
import {
  onServerMainBootstrap,
  onServerMainShutdown,
} from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import { entity, ReflectionKind } from '@deepkit/type';
import { createServer } from 'node:http2';

import { SagaManager } from './saga/saga-manager.js';
import { SAGA_STATE_KEY } from './saga/saga-instance.js';
import { EventHandlers, EventStoreApi } from './event/types.js';
import { InjectorService, InjectorServices } from './services.js';
import { InjectorObject, InjectorObjects } from './objects.js';
import { InjectorSaga, InjectorSagas } from './sagas.js';
import { RestateHandlerMetadata } from './decorator.js';
import { CUSTOM_TERMINAL_ERROR_CODE, RestateConfig } from './config.js';
import { getTypeHash, getTypeName } from './utils.js';
import { RestateAdminClient } from './restate-admin-client.js';
import { serializeRestateHandlerResponse } from './serde.js';
import {
  RestateCustomTerminalErrorMessage,
  restateObjectContextType,
  restateSagaContextType,
  restateServiceContextType,
  SCOPE,
  restateClientType,
  restateBaseContextType,
} from './types.js';
import { RestateIngressClient } from './restate-ingress-client.js';
import { RestatePubSubConfig } from './event/config.js';
import { serializeBSON } from '@deepkit/bson';
import {
  createObjectContext,
  createSagaContext,
  createServiceContext,
  createSharedObjectContext,
} from './context.js';

const DEFAULT_HANDLER_OPTS = {
  input: restate.serde.binary,
  output: restate.serde.binary,
} as const;

export class RestateServer {
  readonly endpoint = restate.endpoint();
  private http2Server?: ReturnType<typeof createServer>;

  constructor(
    private readonly config: RestateConfig,
    private readonly services: InjectorServices,
    private readonly objects: InjectorObjects,
    private readonly sagas: InjectorSagas,
    private readonly injectorContext: InjectorContext,
  ) {}

  @eventDispatcher.listen(onServerMainShutdown)
  async shutdown() {
    await new Promise(resolve => {
      this.http2Server?.close(resolve);
    });
  }

  @eventDispatcher.listen(onServerMainBootstrap)
  async bootstrap() {
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

    await new Promise<void>(resolve => {
      this.http2Server = createServer(this.endpoint.http2Handler());
      this.http2Server.listen(this.config.server?.port!, resolve);
    });

    if (this.config.admin?.deployOnStartup) {
      const admin = this.injectorContext.get(RestateAdminClient);
      if (!config.host) {
        throw new Error('Restate server host is missing');
      }
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

    if (this.config.pubsub) {
      await this.registerEventHandlers(this.config.pubsub);
    }
  }

  private async registerEventHandlers(config: RestatePubSubConfig) {
    let handlers: EventHandlers = [];
    for (const { metadata } of this.services) {
      for (const handler of metadata.handlers) {
        if (handler.event) {
          handlers = [
            ...handlers,
            {
              service: metadata.name,
              method: handler.name,
              eventName: getTypeName(handler.event.type),
              eventVersion: getTypeHash(handler.event.type),
            },
          ];
        }
      }
    }
    if (handlers.length) {
      const eventStore = this.injectorContext.get<EventStoreApi>();
      const client = this.injectorContext.get(RestateIngressClient);
      // TODO: remove old handlers
      await client.send(config.cluster!, eventStore.registerHandlers(handlers));
    }
  }

  private createScopedInjector(): InjectorContext {
    return this.injectorContext.createChildScope(SCOPE);
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
            const ctx = createServiceContext(rsCtx, this.config);
            injector.set(restateClientType, ctx);
            injector.set(restateBaseContextType, ctx);
            injector.set(restateServiceContextType, ctx);
            const instance = injector.get(classType, module);
            return await this.callHandler(instance, handler, data);
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
          const ctx = createSagaContext(rsCtx, this.config);
          injector.set(restateClientType, ctx);
          injector.set(restateBaseContextType, ctx);
          injector.set(restateSagaContextType, ctx);
          const restateSaga = injector.get(classType, module);
          const sagaManager = new SagaManager(ctx, restateSaga, metadata);
          const data = metadata.deserializeData(request);
          await sagaManager.start(data);
          await sagaManager.waitForCompletion();
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
  }: InjectorObject<unknown>) {
    return [...metadata.handlers].reduce(
      (handlers, handler) => ({
        ...handlers,
        // @ts-expect-error: types mismatch
        [handler.name]: (handler.shared
          ? restate.handlers.object.shared
          : restate.handlers.object.exclusive)(
          DEFAULT_HANDLER_OPTS,
          async (
            rsCtx: restate.ObjectContext,
            data: Uint8Array,
          ): Promise<Uint8Array> => {
            const injector = this.createScopedInjector();
            const ctx = handler.shared
              ? createSharedObjectContext(rsCtx, this.config)
              : createObjectContext(rsCtx, this.config);
            injector.set(restateClientType, ctx);
            injector.set(restateBaseContextType, ctx);
            injector.set(restateObjectContextType, ctx);
            const instance = injector.get(classType, module);
            return await this.callHandler(instance, handler, data);
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
        // TODO: use entity name
        typeName: handler.returnType.typeName,
      });
    } catch (error: any) {
      const entityData = entity._fetch(error.constructor);
      if (entityData?.name) {
        throw new restate.TerminalError(
          Buffer.from(
            serializeBSON<RestateCustomTerminalErrorMessage>({
              data: serializeBSON(error, undefined, error.constructor),
              entityName: entityData.name,
            }),
          ).toString('base64'),
          {
            cause: error,
            errorCode: CUSTOM_TERMINAL_ERROR_CODE,
          },
        );
      }
      if (error instanceof TypeError) {
        throw new restate.TerminalError(error.message, {
          cause: error,
          errorCode: 500,
        });
      }
      throw error;
    }
  }
}
