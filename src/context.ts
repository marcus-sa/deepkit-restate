import * as restate from '@restatedev/restate-sdk';
import { ReceiveType } from '@deepkit/type';
import { CUSTOM_TERMINAL_ERROR_CODE, RestateConfig } from './config.js';
import { decodeRestateServiceMethodResponse } from './utils.js';
import {
  createBSONSerde,
  deserializeBSONAndThrowCustomTerminalError,
} from './serde.js';
import {
  RestateAwakeable,
  RestateInvocationHandle,
  RestateObjectContext,
  RestateRunAction,
  RestateSagaContext,
  RestateServiceContext,
  RestateSharedObjectContext,
} from './types.js';
import {
  InvocationId,
  RestatePromise,
  RunOptions,
} from '@restatedev/restate-sdk';

export function createServiceContext(
  ctx: restate.Context,
  config?: RestateConfig,
): RestateServiceContext {
  function extractContextHeaders(): Record<string, string> {
    const entries = Object.entries(ctx.request().headers);
    if (Array.isArray(config?.server?.propagateIncomingHeaders)) {
      return Object.fromEntries(
        entries.filter(([key]) =>
          (config?.server?.propagateIncomingHeaders as string[]).includes(key),
        ),
      );
    }
    return Object.fromEntries(entries);
  }

  return {
    workflowClient: ctx.workflowClient.bind(ctx),
    workflowSendClient: ctx.workflowSendClient.bind(ctx),
    serviceClient: ctx.serviceClient.bind(ctx),
    objectClient: ctx.objectClient.bind(ctx),
    objectSendClient: ctx.objectSendClient.bind(ctx),
    serviceSendClient: ctx.serviceSendClient.bind(ctx),
    rand: ctx.rand,
    date: ctx.date,
    console: ctx.console,
    request: ctx.request.bind(ctx),
    sleep: ctx.sleep.bind(ctx),
    rejectAwakeable: ctx.rejectAwakeable.bind(ctx),
    genericCall: ctx.genericCall.bind(ctx),
    genericSend: ctx.genericSend.bind(ctx),
    cancel: ctx.cancel.bind(ctx),
    attach<T>(
      invocationId: InvocationId,
      type?: ReceiveType<T>,
    ): RestatePromise<T> {
      const serde = createBSONSerde(type);
      return ctx.attach(invocationId, serde);
    },
    resolveAwakeable<T>(id: string, payload?: T, type?: ReceiveType<T>) {
      const serde = createBSONSerde(type);
      ctx.resolveAwakeable(id, payload, serde);
    },
    awakeable<T>(type?: ReceiveType<T>): RestateAwakeable<T> {
      const serde = createBSONSerde<T>(type);
      return ctx.awakeable<T>(serde) as RestateAwakeable<T>;
    },
    run<T = void>(
      name: string,
      action: RestateRunAction<T>,
      options: RunOptions<unknown> = {},
      type?: ReceiveType<T>,
    ): RestatePromise<T> {
      if (type) {
        const serde = createBSONSerde<T>(type);
        return ctx.run(name, action, {
          serde,
          ...options,
        }) as RestatePromise<T>;
      }

      return ctx.run(
        name,
        async () => {
          await action();
        },
        options,
      ) as RestatePromise<never>;
    },
    send(...args: readonly any[]): Promise<RestateInvocationHandle> {
      const [key, { service, method, data }, options] =
        typeof args[0] !== 'string' ? [undefined, ...args] : args;

      const headers = config?.server?.propagateIncomingHeaders
        ? {
            ...extractContextHeaders(),
            ...options?.headers,
          }
        : options?.headers;

      const { invocationId } = ctx.genericSend({
        service,
        method,
        parameter: data,
        delay: options?.delay,
        headers,
        key,
      });

      return invocationId.then(invocationId => ({
        invocationId,
      }));
    },
    call<T>(...args: readonly any[]): RestatePromise<T> {
      const [key, { service, method, data, deserializeReturn }, options] =
        typeof args[0] !== 'string' ? [undefined, ...args] : args;

      const headers = config?.server?.propagateIncomingHeaders
        ? {
            ...extractContextHeaders(),
            ...options?.headers,
          }
        : options?.headers;

      return ctx
        .genericCall({
          service,
          method,
          parameter: data,
          headers,
          key,
          outputSerde: restate.serde.binary,
        })
        .map((value, failure) => {
          if (value) {
            return decodeRestateServiceMethodResponse(value, deserializeReturn);
          }

          if (
            failure instanceof restate.TerminalError &&
            failure.code === CUSTOM_TERMINAL_ERROR_CODE
          ) {
            deserializeBSONAndThrowCustomTerminalError(failure.message);
          }

          throw failure;
        });
    },
  };
}

export function createSharedObjectContext(
  ctx: restate.ObjectSharedContext,
  config?: RestateConfig,
): RestateSharedObjectContext {
  return Object.assign(createServiceContext(ctx, config), {
    key: ctx.key,
    stateKeys: ctx.stateKeys.bind(ctx),
    async get<T>(name: string, type?: ReceiveType<T>): Promise<T | null> {
      const serde = createBSONSerde<T>(type);
      return await ctx.get<T>(name, serde);
    },
  });
}

export function createObjectContext(
  ctx: restate.ObjectContext,
  config?: RestateConfig,
): RestateObjectContext {
  return Object.assign(createSharedObjectContext(ctx, config), {
    clearAll: ctx.clearAll.bind(ctx),
    clear: ctx.clear.bind(ctx),
    set<T>(name: string, value: T, type?: ReceiveType<T>) {
      const serde = createBSONSerde<T>(type);
      ctx.set(name, value, serde);
    },
  });
}

export function createSagaContext(
  ctx: restate.WorkflowContext | restate.WorkflowSharedContext,
  config?: RestateConfig,
): RestateSagaContext {
  return Object.assign(createObjectContext(ctx as any, config), {
    send: undefined,
    call: undefined,
  });
}
