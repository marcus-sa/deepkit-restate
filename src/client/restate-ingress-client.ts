import { ReceiveType, ReflectionKind } from '@deepkit/type';

import { makeInterfaceProxy } from '../utils.js';
import {
  RestateObject,
  RestateObjectHandlerRequest,
  RestateCallOptions,
  RestateSendOptions,
  RestateService,
  RestateServiceHandlerRequest,
  RestateClient,
} from '../types.js';
import { CUSTOM_TERMINAL_ERROR_CODE } from '../config.js';
import type { InvocationHandle } from '@restatedev/restate-sdk';
import { handleCustomTerminalErrorResponse } from '../shared.js';

interface RestateApiResponseError {
  readonly code: string;
  readonly message: string;
}

export class RestateApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RestateIngressClientOptions {
  readonly url: string;
  readonly bson?: boolean;
  readonly headers?: Record<string, string>;
}

export class RestateIngressClient implements RestateClient {
  constructor(private readonly opts: RestateIngressClientOptions) {}

  service<T extends RestateService<string, any>>(type?: ReceiveType<T>): T {
    return makeInterfaceProxy<T>(type);
  }

  object<T extends RestateObject<string, any>>(type?: ReceiveType<T>): T {
    return makeInterfaceProxy<T>(type);
  }

  call<R, A extends any[]>(
    key: string,
    request: RestateObjectHandlerRequest<R, A>,
    options?: RestateCallOptions,
  ): Promise<R>;
  call<R, A extends any[]>(
    request: RestateServiceHandlerRequest<R, A>,
    options?: RestateCallOptions,
  ): Promise<R>;
  async call<R>(...args: readonly any[]): Promise<R> {
    const [
      key,
      { service, method, data, deserializeReturn, returnType },
      options,
    ] = typeof args[0] !== 'string' ? [undefined, ...args] : args;

    const url = new URL(
      key
        ? `${this.opts.url}/${service}/${key}/${method}`
        : `${this.opts.url}/${service}/${method}`,
    );

    const headers = new Headers({
      ...this.opts.headers,
      ...options?.headers,
      'content-type': 'application/json',
      accept: 'application/json',
    });
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(data),
    } as RequestInit);

    if (!response.ok) {
      if (response.status === CUSTOM_TERMINAL_ERROR_CODE) {
        const failure = (await response.json()) as { message: string };
        let error: any;
        try {
          error = handleCustomTerminalErrorResponse(failure.message);
        } catch {
          throw new Error(failure.message);
        }
        throw error;
      }
    }

    if (
      returnType.kind === ReflectionKind.void ||
      returnType.kind === ReflectionKind.undefined
    ) {
      return undefined as R;
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      throw new Error(
        'Expected non-empty response, got 0 bytes. This is likely a server-side error. Please check the server logs for more details.',
      );
    }
    return deserializeReturn(await response.json());
  }

  send(
    key: string,
    request: Omit<RestateObjectHandlerRequest, 'deserializeReturn'>,
    options?: RestateSendOptions,
  ): Promise<InvocationHandle>;
  send(
    request: Omit<RestateServiceHandlerRequest, 'deserializeReturn'>,
    options?: RestateSendOptions,
  ): Promise<InvocationHandle>;
  async send(...args: readonly any[]): Promise<InvocationHandle> {
    const [key, { service, method, data }, options] =
      typeof args[0] !== 'string' ? [undefined, ...args] : args;

    const url = new URL(
      key
        ? `${this.opts.url}/${service}/${key}/${method}/send`
        : `${this.opts.url}/${service}/${method}/send`,
    );
    if (options?.delay) {
      url.searchParams.set('delay', options.delay);
    }

    const headers = new Headers({
      ...this.opts.headers,
      ...options?.headers,
      'content-type': 'application/json',
      accept: 'application/json',
    });
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(data),
    } as RequestInit);
    if (!response.ok) {
      const { message } = (await response.json()) as RestateApiResponseError;
      throw new Error(message);
    }

    return (await response.json()) as InvocationHandle;
  }
}
