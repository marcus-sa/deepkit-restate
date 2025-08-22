import {
  BSONDeserializer,
  BSONSerializer,
  deserializeBSON,
} from '@deepkit/bson';
import {
  ReceiveType,
  resolveReceiveType,
  Type,
  typeSettings,
} from '@deepkit/type';

import { SagaState } from '../saga/saga-instance.js';
import {
  deserializeResponseData,
  getSagaDataDeserializer,
  getSagaDataSerializer,
  deserializeBSONAndThrowCustomTerminalError,
} from '../serde.js';
import { getRestateClassName } from '../metadata.js';
import {
  makeInterfaceProxy,
  decodeRestateServiceMethodResponse,
} from '../utils.js';
import {
  RestateObject,
  RestateObjectHandlerRequest,
  RestateCallOptions,
  RestateSaga,
  RestateSendOptions,
  RestateService,
  RestateServiceHandlerRequest,
  RestateCustomTerminalErrorMessage,
  RestateClient,
} from '../types.js';
import { CUSTOM_TERMINAL_ERROR_CODE } from '../config.js';
import { InvocationHandle } from '@restatedev/restate-sdk';

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

export class RestateSagaClient<Data> {
  private readonly serializeData: BSONSerializer;
  private readonly deserializeData: BSONDeserializer<Data>;
  private readonly serviceName: string;

  constructor(
    private readonly opts: RestateIngressClientOptions,
    private readonly type: Type,
  ) {
    this.serializeData = getSagaDataSerializer(this.type);
    this.deserializeData = getSagaDataDeserializer<Data>(this.type);
    this.serviceName = getRestateClassName(this.type);
  }

  async state(id: string): Promise<SagaState<Data>> {
    const url = `${this.opts.url}/${this.serviceName}/${id}/state`;

    const headers = new Headers({
      ...this.opts.headers,
      'content-type': 'application/octet-stream',
      accept: 'application/octet-stream',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      throw new Error('Missing saga state');
    }

    const state = deserializeResponseData<SagaState>(
      new Uint8Array(await response.arrayBuffer()),
    );

    return {
      sagaData: this.deserializeData(state.sagaData),
      currentState: state.currentState,
    };
  }

  async start(id: string, data: Data): Promise<InvocationHandle> {
    const url = `${this.opts.url}/${this.serviceName}/${id}/run/send`;

    const headers = new Headers({
      ...this.opts.headers,
      'content-type': 'application/octet-stream',
      accept: 'application/json',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: this.serializeData(data),
    });

    return (await response.json()) as InvocationHandle;
  }
}

export class RestateIngressClient implements RestateClient {
  constructor(private readonly opts: RestateIngressClientOptions) {}

  service<T extends RestateService<string, any>>(type?: ReceiveType<T>): T {
    return makeInterfaceProxy<T>(type);
  }

  object<T extends RestateObject<string, any>>(type?: ReceiveType<T>): T {
    return makeInterfaceProxy<T>(type);
  }

  saga<T extends RestateSaga<string, any>>(
    type?: ReceiveType<T>,
  ): RestateSagaClient<T['data']> {
    type = resolveReceiveType(type);
    return new RestateSagaClient(this.opts, type);
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
    const [key, { service, method, data, deserializeReturn }, options] =
      typeof args[0] !== 'string' ? [undefined, ...args] : args;

    const url = new URL(
      key
        ? `${this.opts.url}/${service}/${key}/${method}`
        : `${this.opts.url}/${service}/${method}`,
    );

    const headers = new Headers({
      ...this.opts.headers,
      ...options?.headers,
      'content-type': 'application/octet-stream',
      accept: 'application/octet-stream',
    });
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: data,
    } as RequestInit);

    if (!response.ok) {
      if (response.status === CUSTOM_TERMINAL_ERROR_CODE) {
        const failure = (await response.json()) as { message: string };
        deserializeBSONAndThrowCustomTerminalError(failure.message);
      }
      const { code, message } =
        (await response.json()) as RestateApiResponseError;
      throw new RestateApiError(code, message);
    }

    const result = new Uint8Array(await response.arrayBuffer());

    return decodeRestateServiceMethodResponse(result, deserializeReturn);
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
      'content-type': 'application/octet-stream',
      accept: 'application/octet-stream',
    });
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: data,
    } as RequestInit);
    if (!response.ok) {
      const { message } = (await response.json()) as RestateApiResponseError;
      throw new Error(message);
    }

    return (await response.json()) as InvocationHandle;
  }
}
