import type { WorkflowSubmission } from '@restatedev/restate-sdk-clients/dist/esm/src/api';
import { BSONDeserializer, BSONSerializer } from '@deepkit/bson';
import { ReceiveType, resolveReceiveType, Type } from '@deepkit/type';

import { deserializeSagaState, SagaState } from './saga/saga-instance.js';
import {
  createClassProxy,
  decodeRestateServiceMethodResponse,
  getRestateClassName,
  getSagaDataDeserializer,
  getSagaDataSerializer,
} from './utils.js';
import {
  RestateClientContext,
  RestateObject,
  RestateObjectHandlerRequest,
  RestateRpcOptions,
  RestateSaga,
  RestateSendOptions,
  RestateService,
  RestateServiceHandlerRequest,
  SendStatus,
} from './types.js';

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

function isRestateApiResponseError(
  value: any,
): value is RestateApiResponseError {
  return 'code' in value || 'message' in value;
}

export type WorkflowStartStatus = Omit<
  WorkflowSubmission<unknown>,
  'attachable'
>;

export class RestateIngressClientOptions {
  readonly url: string;
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        accept: 'application/octet-stream',
      },
    });

    if (!response.ok) {
      throw new Error('Missing saga state');
    }

    const state = deserializeSagaState(
      new Uint8Array(await response.arrayBuffer()),
    );

    return {
      sagaData: this.deserializeData(state.sagaData),
      currentState: state.currentState,
    };
  }

  async start(id: string, data: Data): Promise<WorkflowStartStatus> {
    const url = `${this.opts.url}/${this.serviceName}/${id}/run/send`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        accept: 'application/json',
      },
      body: this.serializeData(data),
    });

    return (await response.json()) as WorkflowStartStatus;
  }
}

export class RestateClient implements RestateClientContext {
  constructor(private readonly opts: RestateIngressClientOptions) {
  }

  service<T extends RestateService<string, any, any[]>>(
    type?: ReceiveType<T>,
  ): T {
    return createClassProxy<T>(type);
  }

  object<T extends RestateObject<string, any, any[]>>(
    type?: ReceiveType<T>,
  ): T {
    return createClassProxy<T>(type);
  }

  saga<T extends RestateSaga<string, any>>(
    type?: ReceiveType<T>,
  ): RestateSagaClient<T['data']> {
    type = resolveReceiveType(type);
    return new RestateSagaClient(this.opts, type);
  }

  rpc<R, A extends any[]>(
    key: string,
    request: RestateObjectHandlerRequest<R, A>,
    options?: RestateRpcOptions,
  ): Promise<R>;
  rpc<R, A extends any[]>(
    request: RestateServiceHandlerRequest<R, A>,
    options?: RestateRpcOptions,
  ): Promise<R>;
  async rpc<R>(...args: readonly any[]): Promise<R> {
    const [
      key,
      { service, method, data, deserializeReturn, entities },
      options,
    ] = args.length === 1 ? [undefined, ...args] : args;

    const url = new URL(
      key
        ? `${this.opts.url}/${service}/${key}/${method}`
        : `${this.opts.url}/${service}/${method}`,
    );

    const headers = new Headers([
      ['content-type', 'application/octet-stream'],
      ['accept', 'application/octet-stream'],
    ]);
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: data, // TODO: uint8arrays
    } as RequestInit);

    const result = new Uint8Array(await response.arrayBuffer());

    // const result = (await response.json()) as
    //   | RestateApiResponseError
    //   | RestateRpcResponse;
    // if (isRestateApiResponseError(result)) {
    //   throw new RestateApiError(result.code, result.message);
    // }

    return decodeRestateServiceMethodResponse(
      result,
      deserializeReturn,
      entities,
    );
  }

  send(
    key: string,
    request: RestateObjectHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<SendStatus>;
  send(
    request: RestateServiceHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<SendStatus>;
  async send(...args: readonly any[]): Promise<SendStatus> {
    const [key, { service, method, data }, options] =
      args.length === 1 ? [undefined, ...args] : args;

    const url = new URL(
      key
        ? `${this.opts.url}/${service}/${key}/${method}/send`
        : `${this.opts.url}/${service}/${method}/send`,
    );
    if (options?.delay) {
      url.searchParams.set('delay', options.delay);
    }

    const headers = new Headers([
      ['content-type', 'application/octet-stream'],
      ['accept', 'application/json'],
    ]);
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: data,
    } as RequestInit);

    return (await response.json()) as SendStatus;
  }
}
