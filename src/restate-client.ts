import { BSONDeserializer, BSONSerializer } from '@deepkit/bson';
import {ReceiveType, resolveReceiveType, Type, uuid} from '@deepkit/type';
import {InjectorContext} from "@deepkit/injector";

import { SagaState } from './saga/saga-instance.js';
import {
  deserializeResponseData,
  getSagaDataDeserializer,
  getSagaDataSerializer,
} from './serde.js';
import {getRestateClassName} from './metadata.js';
import {
  createClassProxy,
  decodeRestateServiceMethodResponse,
} from './utils.js';
import {
  RestateObject, restateObjectContextType,
  RestateObjectHandlerRequest,
  RestateRpcOptions,
  RestateSaga,
  RestateSendOptions,
  RestateService, restateServiceContextType,
  RestateServiceHandlerRequest,
  RestateStatus, SCOPE,
} from './types.js';
import {RestateModule} from "./restate.module.js";
import {RestateMemoryContext} from "./restate-context-storage.js";

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
  readonly headers?: Record<string, string>;
}

export interface IRestateSagaClient<Data> {
  state(id: string): Promise<SagaState<Data>>;
  start(id: string, data: Data): Promise<RestateStatus>;
}

export class RestateSagaClient<Data> implements IRestateSagaClient<Data> {
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

    const state = deserializeResponseData<SagaState>(
      new Uint8Array(await response.arrayBuffer()),
    );

    return {
      sagaData: this.deserializeData(state.sagaData),
      currentState: state.currentState,
    };
  }

  async start(id: string, data: Data): Promise<RestateStatus> {
    const url = `${this.opts.url}/${this.serviceName}/${id}/run/send`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        accept: 'application/json',
      },
      body: this.serializeData(data),
    });

    return (await response.json()) as RestateStatus;
  }
}

export interface RestateClient {
  service<T extends RestateService<string, any, any[]>>(
    type?: ReceiveType<T>,
  ): T;
  object<T extends RestateObject<string, any, any[]>>(
    type?: ReceiveType<T>,
  ): T
  saga<T extends RestateSaga<string, any>>(
    type?: ReceiveType<T>,
  ): IRestateSagaClient<T['data']>;
  rpc<R, A extends any[]>(
    key: string,
    request: RestateObjectHandlerRequest<R, A>,
    options?: RestateRpcOptions,
  ): Promise<R>;
  rpc<R, A extends any[]>(
    request: RestateServiceHandlerRequest<R, A>,
    options?: RestateRpcOptions,
  ): Promise<R>;
  send(
    key: string,
    request: RestateObjectHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<RestateStatus>;
  send(
    request: RestateServiceHandlerRequest,
    options?: RestateSendOptions,
  ): Promise<RestateStatus>;
}

export class RestateHttpClient implements RestateClient {
  constructor(private readonly opts: RestateIngressClientOptions) {}

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
    ) as URL;

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
      body: data,
    } as RequestInit);

    if (!response.ok) {
      const { code, message } =
        (await response.json()) as RestateApiResponseError;
      throw new RestateApiError(code, message);
    }

    const result = new Uint8Array(await response.arrayBuffer());

    return decodeRestateServiceMethodResponse(
      result,
      deserializeReturn,
      entities,
    );
  }

  async send(...args: readonly any[]): Promise<RestateStatus> {
    const [key, { service, method, data }, options] =
      args.length === 1 ? [undefined, ...args] : args;

    const url = new URL(
      key
        ? `${this.opts.url}/${service}/${key}/${method}/send`
        : `${this.opts.url}/${service}/${method}/send`,
    ) as URL;
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

    return (await response.json()) as RestateStatus;
  }
}

export class RestateMemoryClient implements RestateClient {
  constructor(
    private readonly module: RestateModule,
    private readonly injectorContext: InjectorContext,
  ) {}

  service<T extends RestateService<string, any, any[]>>(
    type?: ReceiveType<T>,
  ): T {
    type = resolveReceiveType(type);
    const serviceName = getRestateClassName(type);
    const serviceModule = [...this.module.services]
      .find(service => service.metadata.name === serviceName);
    if (!serviceModule) {
      throw new Error(`No service module found for ${serviceName}`);
    }
    const injector = this.injectorContext.createChildScope(SCOPE);
    injector.set(restateServiceContextType, new RestateMemoryContext(this));
    return injector.get(serviceModule.classType, serviceModule.module) as T;
  }

  object<T extends RestateObject<string, any, any[]>>(
    type?: ReceiveType<T>,
  ): T {
    type = resolveReceiveType(type);
    const objectName = getRestateClassName(type);
    const objectModule = [...this.module.objects]
      .find(object => object.metadata.name === objectName);
    if (!objectModule) {
      throw new Error(`No object module found for ${objectName}`);
    }
    const injector = this.injectorContext.createChildScope(SCOPE);
    injector.set(restateObjectContextType, new RestateMemoryContext(this));
    return injector.get(objectModule.classType, objectModule.module) as T;
  }

  saga<T extends RestateSaga<string, any>>(
    type?: ReceiveType<T>,
  ): RestateSagaClient<T['data']> {
    throw new Error('Not yet implemented');
  }

  async rpc<R>(...args: readonly any[]): Promise<R> {
    const [, result] =
      args.length === 1 ? [undefined, ...args] : args;
    return await result;
  }

  async send(...args: readonly any[]): Promise<RestateStatus> {
    const [, result] =
      args.length === 1 ? [undefined, ...args] : args;
    await result;
    return { invocationId: uuid(), status: 'Accepted' };
  }
}
