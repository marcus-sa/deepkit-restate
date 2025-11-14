import { eventDispatcher } from '@deepkit/event';
import {
  onServerMainBootstrap,
  onServerMainShutdown,
} from '@deepkit/framework';
import { InjectorContext } from '@deepkit/injector';
import * as restate from '@restatedev/restate-sdk';
import {
  LogMetadata,
  RetryableError,
  TerminalError,
} from '@restatedev/restate-sdk';
import {
  entity,
  hasTypeInformation,
  ReflectionKind,
  serialize,
  TypeClass,
  TypeObjectLiteral,
} from '@deepkit/type';
import { createServer } from 'node:http2';
import { serializeBSON } from '@deepkit/bson';
import { ScopedLogger } from '@deepkit/logger';

import { EventHandlers, EventStoreApi } from './event/types.js';
import { InjectorService } from './services.js';
import { InjectorObject } from './objects.js';
import { RestateClassMetadata, RestateHandlerMetadata } from './decorator.js';
import { CUSTOM_TERMINAL_ERROR_CODE } from './config.js';
import { getTypeHash, getTypeName } from './utils.js';
import { RestateAdminClient } from './client/restate-admin-client.js';
import {
  RestateCustomTerminalErrorMessage,
  restateObjectContextType,
  restateSagaContextType,
  restateServiceContextType,
  SCOPE,
  restateClientType,
  restateSharedContextType,
  RestateSharedContext,
} from './types.js';
import { RestateIngressClient } from './client/restate-ingress-client.js';
import { RestatePubSubConfig } from './event/config.js';
import {
  createObjectContext,
  createSagaContext,
  createServiceContext,
  createSharedObjectContext,
} from './context.js';
import { createJSONSerde } from './serde.js';
import { getSagaDataType } from './metadata.js';
import { RestateModule } from './restate.module.js';
import { isRestateMiddlewareFn } from './middleware.js';

export class RestateServer {
  private http2Server?: ReturnType<typeof createServer>;

  constructor(
    private readonly module: RestateModule,
    private readonly injectorContext: InjectorContext,
    private readonly logger: ScopedLogger,
  ) {}

  @eventDispatcher.listen(onServerMainShutdown)
  async shutdown() {
    await new Promise(resolve => {
      this.http2Server?.close(resolve);
    });
  }

  private handleError(error: any): TerminalError | undefined {
    if (
      !(error instanceof RetryableError) &&
      hasTypeInformation(error.constructor)
    ) {
      const entityData = entity._fetch(error.constructor);
      if (!entityData) return undefined;

      throw new restate.TerminalError(
        JSON.stringify({
          data: serialize(error, undefined, error.constructor),
          entityName: entityData.name,
        }),
        {
          cause: error,
          // TODO: mapper for custom error codes
          errorCode: CUSTOM_TERMINAL_ERROR_CODE,
        },
      );
    }
    if (error instanceof TypeError) {
      return new restate.TerminalError(error.message, {
        cause: error,
        errorCode: 500,
      });
    }

    return undefined;
  }

  @eventDispatcher.listen(onServerMainBootstrap)
  async bootstrap() {
    const services: restate.EndpointOptions['services'] = [];

    const asTerminalError = (error: any) => this.handleError(error);

    for (const object of this.module.objects) {
      const handlers = this.createObjectHandlers(object);
      services.push(
        restate.object({
          name: object.metadata.name,
          handlers,
          options: {
            ...object.metadata.options,
            asTerminalError,
          },
        }),
      );
    }

    for (const service of this.module.services) {
      const handlers = this.createServiceHandlers(service);
      services.push(
        restate.service({
          name: service.metadata.name,
          handlers,
          options: {
            ...service.metadata.options,
            asTerminalError,
          },
        }),
      );
    }

    const handler = restate.createEndpointHandler({
      services,
      defaultServiceOptions: {},
      logger: (
        params: LogMetadata,
        message?: any,
        ...optionalParams: any[]
      ) => {
        if (params.replaying) return;
        if (params.context) {
          this.logger.data(params.context);
        }
        if (params.level === 'trace') return;
        this.logger[params.level](message, ...optionalParams);
      },
    });

    await new Promise<void>(resolve => {
      this.http2Server = createServer(handler);
      this.http2Server.listen(this.module.config.server?.port!, resolve);
    });

    if (this.module.config.admin?.deployOnStartup) {
      const admin = this.injectorContext.get(RestateAdminClient);
      if (!this.module.config.server?.host) {
        throw new Error('Restate server host is missing');
      }
      await admin.deployments.create(
        `${this.module.config.server.host}:${this.module.config.server.port}`,
      );
    }

    if (this.module.config.kafka) {
      if (!this.module.config.admin) {
        throw new Error('Restate admin config is missing for Kafka');
      }
      // TODO: filter out handlers by existing subscriptions
      await Promise.all([
        this.addKafkaHandlerSubscriptions('object', [...this.module.objects]),
        this.addKafkaHandlerSubscriptions('service', [...this.module.services]),
      ]);
    }

    if (this.module.config.pubsub) {
      await this.registerEventHandlers(this.module.config.pubsub);
    }
  }

  private async registerEventHandlers(config: RestatePubSubConfig) {
    let handlers: EventHandlers = [];

    // Register service event handlers
    for (const { metadata } of this.module.services) {
      for (const handler of metadata.handlers) {
        if (handler.event) {
          function addHandler(type: TypeClass | TypeObjectLiteral) {
            handlers = [
              ...handlers,
              {
                service: metadata.name,
                method: handler.name,
                eventName: getTypeName(type),
                eventVersion: getTypeHash(type),
                handlerType: 'service' as const,
              },
            ];
          }

          if (handler.event.type.kind === ReflectionKind.union) {
            for (const type of handler.event.type.types) {
              addHandler(type as TypeClass | TypeObjectLiteral);
            }
          } else {
            addHandler(handler.event.type);
          }
        }
      }
    }

    // Register object event handlers
    for (const { metadata } of this.module.objects) {
      for (const handler of metadata.handlers) {
        if (handler.event) {
          function addHandler(type: TypeClass | TypeObjectLiteral) {
            handlers = [
              ...handlers,
              {
                service: metadata.name,
                method: handler.name,
                eventName: getTypeName(type),
                eventVersion: getTypeHash(type),
                handlerType: 'object' as const,
              },
            ];
          }

          if (handler.event.type.kind === ReflectionKind.union) {
            for (const type of handler.event.type.types) {
              addHandler(type as TypeClass | TypeObjectLiteral);
            }
          } else {
            addHandler(handler.event.type);
          }
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
          const url = `${this.module.config.admin!.url}/subscriptions`;

          await admin.kafka.subscriptions.create({
            source: `kafka://${this.module.config.kafka!.clusterName}/${handler.kafka!.topic}`,
            // TODO: figure out if protocol "object://" is needed for objects
            sink: `${protocol}://${metadata.name}/${handler.name}`,
            options: handler.kafka?.options,
          });
        });
      }),
    );
  }

  // TODO: wrap in custom error
  private async executeMiddlewares(
    injectorContext: InjectorContext,
    ctx: RestateSharedContext,
    classMetadata: RestateClassMetadata,
    handlerMetadata?: RestateHandlerMetadata,
  ) {
    for (const middleware of this.module.globalMiddlewares) {
      if (isRestateMiddlewareFn(middleware)) {
        await middleware(ctx, classMetadata, handlerMetadata);
      } else {
        await injectorContext
          .get(middleware)
          .execute(ctx, classMetadata, handlerMetadata);
      }
    }
    for (const middleware of classMetadata.middlewares) {
      if (isRestateMiddlewareFn(middleware)) {
        await middleware(ctx, classMetadata, handlerMetadata);
      } else {
        await injectorContext
          .get(middleware)
          .execute(ctx, classMetadata, handlerMetadata);
      }
    }
    if (handlerMetadata) {
      for (const middleware of handlerMetadata.middlewares) {
        if (isRestateMiddlewareFn(middleware)) {
          await middleware(ctx, classMetadata, handlerMetadata);
        } else {
          await injectorContext
            .get(middleware)
            .execute(ctx, classMetadata, handlerMetadata);
        }
      }
    }
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
          {
            input: createJSONSerde(handler.argsType),
            output: createJSONSerde(handler.returnType),
            ...handler.options,
          },
          async (rsCtx: restate.Context, data: unknown): Promise<any> => {
            const injector = this.createScopedInjector();
            injector.set(InjectorContext, injector);
            const ctx = createServiceContext(
              rsCtx,
              injector,
              this.module.config,
            );
            injector.set(restateClientType, ctx);
            injector.set(restateSharedContextType, ctx);
            injector.set(restateServiceContextType, ctx);
            await this.executeMiddlewares(injector, ctx, metadata, handler);
            const instance: any = injector.get(classType, module);
            const result = await instance[handler.name].bind(instance)(data);
            if (
              handler.returnType &&
              handler.returnType.kind !== ReflectionKind.void &&
              handler.returnType.kind !== ReflectionKind.undefined
            ) {
              return result;
            }
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
        // @ts-ignore
        [handler.name]: (handler.shared
          ? restate.handlers.object.shared
          : restate.handlers.object.exclusive)(
          {
            input: createJSONSerde(handler.argsType),
            output: createJSONSerde(handler.returnType),
            ...handler.options,
          },
          async (rsCtx: restate.ObjectContext, data: unknown): Promise<any> => {
            const injector = this.createScopedInjector();
            injector.set(InjectorContext, injector);
            const ctx = handler.shared
              ? createSharedObjectContext(rsCtx, injector, this.module.config)
              : createObjectContext(rsCtx, injector, this.module.config);
            injector.set(restateClientType, ctx);
            injector.set(restateSharedContextType, ctx);
            injector.set(restateObjectContextType, ctx);
            await this.executeMiddlewares(injector, ctx, metadata, handler);
            const instance: any = injector.get(classType, module);
            const result = await instance[handler.name].bind(instance)(data);
            if (
              handler.returnType &&
              handler.returnType.kind !== ReflectionKind.void &&
              handler.returnType.kind !== ReflectionKind.undefined
            ) {
              return result;
            }
          },
        ),
      }),
      {},
    );
  }
}
