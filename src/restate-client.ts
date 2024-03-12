import {
  integer,
  PositiveNoZero,
  ReceiveType,
  uuid,
  assert,
  resolveReceiveType,
  Type,
} from '@deepkit/type';

import {
  assertArgs,
  createServiceProxy,
  decodeInternalResponse,
  getSagaDataSerializer,
  getSagaDataType,
  getRestateSagaName,
} from './utils';
import {
  RestateServiceMethodCall,
  RestateService,
  RestateClientCallOptions,
  RestateApiInvocation,
  RestateRpcResponse,
  RestateKeyedService,
  RestateSaga,
} from './types';
import {
  bsonBinarySerializer,
  getBSONSerializer,
  serializeBSON,
} from '@deepkit/bson';
import { TerminalError } from '@restatedev/restate-sdk';

export interface RestateClientOptions {
  // Not implemented (see https://discord.com/channels/1128210118216007792/1214635273141616761/1214932617435156510)
  // readonly authToken: string;
}

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
  return 'code' in value;
}

export class RestateSagaClient<D> {
  private readonly serializeData = getSagaDataSerializer(this.type);
  private readonly serviceName = getRestateSagaName(this.type);

  constructor(
    private readonly client: RestateClient,
    private readonly type: Type,
  ) {}

  // status(key: string) {}

  async create(key: string, data: D): Promise<void> {
    const request = Array.from(this.serializeData(data));

    const response = await fetch(
      `${this.client.url}/dev.restate.Ingress/Invoke`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          service: this.serviceName,
          method: 'create',
          argument: { key, request },
        }),
      },
    );

    if (!response.ok) {
      throw new TerminalError(await response.text());
    }
  }
}

export class RestateClient {
  constructor(
    readonly url: string, // ingress
    private readonly options?: RestateClientOptions,
  ) {}

  service<
    T extends
      | RestateService<string, any, any[]>
      | RestateKeyedService<string, any, any[]>,
  >(type?: ReceiveType<T>): T {
    return createServiceProxy<T>(type);
  }

  saga<D, T extends RestateSaga<string, D>>(
    type?: ReceiveType<T>,
  ): RestateSagaClient<D> {
    type = resolveReceiveType(type);
    return new RestateSagaClient(this, type);
  }

  async rpc<R, A extends any[]>(
    {
      service,
      method,
      data,
      keyed,
      deserializeReturn,
      entities,
    }: RestateServiceMethodCall<R, A>,
    { key }: RestateClientCallOptions = {},
  ): Promise<R> {
    assertArgs({ keyed }, { key });

    const response = await fetch(`${this.url}/${service}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': key != null ? key.toString() : uuid(),
        // Authorization: `Bearer ${this.options.authToken}`,
      },
      body: JSON.stringify({
        key: key != null ? key.toString() : undefined,
        request: data,
      }),
    });

    const result = (await response.json()) as
      | RestateApiResponseError
      | { readonly id: string; readonly response: RestateRpcResponse };
    if (isRestateApiResponseError(result)) {
      throw new RestateApiError(result.code, result.message);
    }

    return decodeInternalResponse(
      new Uint8Array(result.response),
      deserializeReturn,
      entities,
    );
  }

  async send<R, A extends any[]>(
    { service, method, data, keyed }: RestateServiceMethodCall<R, A>,
    { key }: RestateClientCallOptions = {},
  ): Promise<RestateApiInvocation> {
    assertArgs({ keyed }, { key });

    const response = await fetch(`${this.url}/dev.restate.Ingress/Invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': keyed ? key!.toString() : uuid(),
        // Authorization: `Bearer ${this.options.authToken}`,
      },
      body: JSON.stringify({
        service,
        method,
        argument: { key, request: data },
      }),
    });

    const result = (await response.json()) as
      | RestateApiResponseError
      | RestateApiInvocation;
    if (isRestateApiResponseError(result)) {
      throw new RestateApiError(result.code, result.message);
    }

    return result;
  }

  async sendDelayed<R, A extends any[]>(
    { service, method, data, keyed }: RestateServiceMethodCall<R, A>,
    ms: number,
    { key }: RestateClientCallOptions = {},
  ): Promise<void> {
    assertArgs({ keyed }, { key });
    assert<integer & PositiveNoZero>(ms);

    throw new Error('Unimplemented');
  }
}
