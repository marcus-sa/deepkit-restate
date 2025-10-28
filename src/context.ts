import * as restate from '@restatedev/restate-sdk';
import {
  InvocationHandle,
  InvocationId,
  RestatePromise,
  RunOptions,
  TerminalError,
} from '@restatedev/restate-sdk';
import { ReceiveType, ReflectionKind, resolveReceiveType } from '@deepkit/type';
import { InjectorContext } from '@deepkit/injector';
import { CUSTOM_TERMINAL_ERROR_CODE, RestateConfig } from './config.js';
import { decodeRestateServiceMethodResponse } from './utils.js';
import {
  createJSONSerde,
  deserializeBSONAndThrowCustomTerminalError,
} from './serde.js';
import {
  RestateAwakeable,
  RestateObjectContext,
  RestateRunAction,
  RestateSagaContext,
  RestateServiceContext,
  RestateSharedObjectContext,
} from './types.js';

export function createServiceContext(
  ctx: restate.Context,
  injector: InjectorContext,
  config?: RestateConfig,
): RestateServiceContext {
  function propagateRequestHeaders() {
    const headers = ctx.request().headers.entries();
    if (config?.server?.propagateIncomingHeaders) {
      return Object.fromEntries(
        headers.filter(([key]) =>
          config.server!.propagateIncomingHeaders!.includes(key),
        ),
      );
    }
    return Object.fromEntries(headers);
  }

  return {
    injector,
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
    genericCall(call) {
      const headers = config?.server?.propagateIncomingHeaders
        ? {
            ...propagateRequestHeaders(),
            ...call?.headers,
          }
        : call?.headers;
      return ctx.genericCall({
        ...call,
        headers,
      });
    },
    genericSend(call) {
      const headers = config?.server?.propagateIncomingHeaders
        ? {
            ...propagateRequestHeaders(),
            ...call?.headers,
          }
        : call?.headers;
      return ctx.genericSend({
        ...call,
        headers,
      });
    },
    cancel: ctx.cancel.bind(ctx),
    attach<T>(
      invocationId: InvocationId,
      type?: ReceiveType<T>,
    ): RestatePromise<T> {
      const serde = createJSONSerde<T>(type);
      return ctx.attach(invocationId, serde);
    },
    resolveAwakeable<T>(id: string, payload?: T, type?: ReceiveType<T>) {
      const serde = createJSONSerde<T>(type);
      ctx.resolveAwakeable(id, payload, serde);
    },
    awakeable<T>(type?: ReceiveType<T>): RestateAwakeable<T> {
      const serde = createJSONSerde<T>(type);
      return ctx.awakeable<T>(serde) as RestateAwakeable<T>;
    },
    run<T>(
      name: string,
      action: RestateRunAction<T>,
      options: RunOptions<unknown> = {},
      type?: ReceiveType<T>,
    ): RestatePromise<T> {
      type = resolveReceiveType(type);

      if (type.kind === ReflectionKind.unknown) {
        throw new TerminalError('run type cannot be unknown');
      }

      // nothing
      if (
        type.kind === ReflectionKind.void ||
        type.kind === ReflectionKind.undefined
      ) {
        return ctx.run(
          name,
          async () => {
            await action();
          },
          options,
        ) as RestatePromise<T>;
      }

      const serde = createJSONSerde<T>(type);
      return ctx.run(name, action, {
        serde,
        ...options,
      }) as RestatePromise<T>;
    },
    async send(...args: readonly any[]): Promise<InvocationHandle> {
      const [key, { service, method, data }, options] =
        typeof args[0] !== 'string' ? [undefined, ...args] : args;

      const headers = config?.server?.propagateIncomingHeaders
        ? {
            ...propagateRequestHeaders(),
            ...options?.headers,
          }
        : options?.headers;

      return ctx.genericSend({
        idempotencyKey: options?.idempotencyKey,
        service,
        method,
        parameter: data,
        delay: options?.delay,
        headers,
        key,
      });
    },
    call<T>(...args: readonly any[]): RestatePromise<T> {
      const [key, { service, method, data, deserializeReturn }, options] =
        typeof args[0] !== 'string' ? [undefined, ...args] : args;

      const headers = config?.server?.propagateIncomingHeaders
        ? {
            ...propagateRequestHeaders(),
            ...options?.headers,
          }
        : options?.headers;

      return ctx
        .genericCall({
          idempotencyKey: options?.idempotencyKey,
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
  injector: InjectorContext,
  config?: RestateConfig,
): RestateSharedObjectContext {
  return Object.assign(createServiceContext(ctx, injector, config), {
    key: ctx.key,
    stateKeys: ctx.stateKeys.bind(ctx),
    get<T>(name: string, type?: ReceiveType<T>): Promise<T | null> {
      if (type) {
        const serde = createJSONSerde<T>(type);
        return ctx.get<T>(name, serde);
      }
      return ctx.get<T>(name);
    },
  });
}

export function createObjectContext(
  ctx: restate.ObjectContext,
  injector: InjectorContext,
  config?: RestateConfig,
): RestateObjectContext {
  return Object.assign(createSharedObjectContext(ctx, injector, config), {
    clearAll: ctx.clearAll.bind(ctx),
    clear: ctx.clear.bind(ctx),
    set<T>(name: string, value: T, type?: ReceiveType<T>) {
      if (type) {
        const serde = createJSONSerde<T>(type);
        ctx.set(name, value, serde);
      } else {
        ctx.set(name, value);
      }
    },
  });
}

export function createSagaContext(
  ctx: restate.WorkflowContext | restate.WorkflowSharedContext,
  injector: InjectorContext,
  config?: RestateConfig,
): RestateSagaContext {
  return Object.assign(createObjectContext(ctx as any, injector, config), {
    send: undefined,
    call: undefined,
  });
}
