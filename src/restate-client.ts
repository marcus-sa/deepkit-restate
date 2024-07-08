import * as restate from '@restatedev/restate-sdk-clients';
import type { Output, WorkflowSubmission } from '@restatedev/restate-sdk-clients/dist/esm/src/api';
import { BSONDeserializer, BSONSerializer } from '@deepkit/bson';
import { ReceiveType, resolveReceiveType, Type, uint8 } from '@deepkit/type';

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
  RestateObjectMethodRequest,
  RestateRpcOptions,
  RestateRpcResponse,
  RestateSaga,
  RestateSendOptions,
  RestateService,
  RestateServiceMethodRequest,
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

export class RestateSagaClient<Data> {
  private readonly serializeData: BSONSerializer;
  private readonly deserializeData: BSONDeserializer<Data>;
  private readonly serviceName: string;

  constructor(
    private readonly ingress: restate.Ingress,
    private readonly type: Type,
  ) {
    this.serializeData = getSagaDataSerializer(this.type);
    this.deserializeData = getSagaDataDeserializer<Data>(this.type);
    this.serviceName = getRestateClassName(this.type);
  }

  async state(id: string): Promise<SagaState<Data>> {
    // @ts-ignore
    const client = await this.ingress.workflowClient(
      { name: this.serviceName },
      id,
    );

    const result = (await (client as any)['state']()) as
      | readonly uint8[]
      | null;
    if (!result) {
      throw new Error('Missing saga state');
    }

    const state = deserializeSagaState(new Uint8Array(result));

    return {
      sagaData: this.deserializeData(state.sagaData),
      currentState: state.currentState,
    };
  }

  async status(id: string): Promise<Output<Data>> {
    return await this.ingress
      .workflowClient(
        { name: this.serviceName },
        id,
        // @ts-ignore
      )
      .workflowOutput();
  }

  async start(id: string, data: Data): Promise<WorkflowSubmission<unknown>> {
    const request = Array.from(this.serializeData(data));
    // @ts-ignore
    const { status } = await this.ingress
      .workflowClient({ name: this.serviceName }, id)
      .workflowSubmit({
        request,
      });
    return status;
  }
}

export class RestateClient implements RestateCustomContext {
  private readonly ingress: restate.Ingress;

  constructor(private readonly opts: restate.ConnectionOpts) {
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
    return new RestateSagaClient(this.ingress, type);
  }

  rpc<R, A extends any[]>(
    key: string,
    call: RestateObjectMethodRequest<R, A>,
    options?: RestateRpcOptions,
  ): Promise<R>;
  rpc<R, A extends any[]>(
    call: RestateServiceMethodRequest<R, A>,
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
      new Uint8Array(result),
      deserializeReturn,
      entities,
    );
  }

  send(
    key: string,
    call: RestateObjectMethodRequest,
    options?: RestateSendOptions,
  ): Promise<void>;
  send(
    call: RestateServiceMethodRequest,
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
  }
}
