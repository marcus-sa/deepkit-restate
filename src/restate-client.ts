import * as restate from '@restatedev/restate-sdk-clients';
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
  RestateCustomContext,
  RestateObject,
  RestateObjectHandlerRequest,
  RestateRpcOptions,
  RestateRpcResponse,
  RestateSaga,
  RestateSendOptions,
  RestateService,
  RestateServiceHandlerRequest,
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

export type WorkflowStartStatus = Omit<WorkflowSubmission<unknown>, 'attachable'>;

export class RestateSagaClient<Data> {
  private readonly serializeData: BSONSerializer;
  private readonly deserializeData: BSONDeserializer<Data>;
  private readonly serviceName: string;

  constructor(
    private readonly opts: restate.ConnectionOpts,
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
        'content-type': 'application/json',
      },
    });

    const result = await response.json() as RestateRpcResponse | null;
    if (!result) {
      throw new Error('Missing saga state');
    }

    const state = deserializeSagaState(new Uint8Array(result));

    return {
      sagaData: this.deserializeData(state.sagaData),
      currentState: state.currentState,
    };
  }

  // async status(id: string): Promise<Output<Data>> {
  //   return await this.ingress
  //     .workflowClient(
  //       { name: this.serviceName },
  //       id,
  //     )
  //     .workflowOutput();
  // }

  async start(id: string, data: Data): Promise<WorkflowStartStatus> {
    const url = `${this.opts.url}/${this.serviceName}/${id}/run/send`;

    const request = Array.from(this.serializeData(data));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ request }),
    });

    const { startStatus } = await response.json() as { readonly startStatus: WorkflowStartStatus };
    return startStatus;
  }
}

export class RestateClient implements RestateCustomContext {
  private readonly ingress: restate.Ingress;

  constructor(private readonly opts: restate.ConnectionOpts) {
    this.ingress = restate.connect(opts);
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

    const headers = new Headers([['content-type', 'application/json']]);
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(Array.from(data)),
    });

    const result = (await response.json()) as
      | RestateApiResponseError
      | RestateRpcResponse;
    if (isRestateApiResponseError(result)) {
      throw new RestateApiError(result.code, result.message);
    }

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
  ): Promise<void>;
  send(
    request: RestateServiceHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<void>;
  async send(...args: readonly any[]): Promise<void> {
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

    const headers = new Headers([['content-type', 'application/json']]);
    if (options?.idempotencyKey) {
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(Array.from(data)),
    });

    const result = (await response.json()) as
      | RestateApiResponseError
      | undefined;
    if (isRestateApiResponseError(result)) {
      throw new RestateApiError(result.code, result.message);
    }
    return result;
  }
}
