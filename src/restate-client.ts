import {
  deserialize,
  integer,
  PositiveNoZero,
  ReceiveType,
  serializer,
  uuid,
  assert,
} from '@deepkit/type';

import { createServiceProxy } from './utils';
import {
  RestateServiceMethodCall,
  RestateService,
  RestateServiceOptions,
} from './types';

export interface RestateClientOptions {
  // Not implemented (see https://discord.com/channels/1128210118216007792/1214635273141616761/1214932617435156510)
  // readonly authToken: string;
}

export interface RestateClientCallOptions {
  readonly key?: string | number;
}

interface RestateApiResponseError {
  readonly code: string;
  readonly message: string;
}

export interface RestateApiInvocation {
  readonly id: string;
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

function assertArgs(
  { keyed }: RestateServiceOptions,
  { key }: RestateClientCallOptions,
) {
  if (keyed && key == null) {
    throw new Error('Missing key for keyed service');
  }
  if (key != null && !keyed) {
    throw new Error('Unnecessary key for unkeyed service');
  }
}

export class RestateClient {
  constructor(
    private readonly url: string, // ingress
    private readonly options?: RestateClientOptions,
  ) {}

  service<T extends RestateService<string, any>>(type?: ReceiveType<T>): T {
    return createServiceProxy<T>(type);
  }

  async rpc<R, A extends any[]>(
    {
      service,
      method,
      args,
      options: { keyed },
      returnType,
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
        request: args,
      }),
    });

    const result = (await response.json()) as
      | RestateApiResponseError
      | { readonly response: unknown };
    if (isRestateApiResponseError(result)) {
      throw new RestateApiError(result.code, result.message);
    }

    return deserialize<R>(
      result.response,
      { loosely: false },
      serializer,
      undefined,
      returnType,
    );
  }

  async send<R, A extends any[]>(
    {
      service,
      method,
      args,
      options: { keyed },
    }: RestateServiceMethodCall<R, A>,
    { key }: RestateClientCallOptions = {},
  ): Promise<RestateApiInvocation> {
    assertArgs({ keyed }, { key });

    const result = await fetch(`${this.url}/dev.restate.Ingress/Invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': keyed ? key!.toString() : uuid(),
        // Authorization: `Bearer ${this.options.authToken}`,
      },
      body: JSON.stringify({
        service,
        method,
        argument: keyed ? { key, request: args } : args,
      }),
    });

    return (await result.json()) as RestateApiInvocation;
  }

  async sendDelayed<R, A extends any[]>(
    {
      service,
      method,
      args,
      options: { keyed },
    }: RestateServiceMethodCall<R, A>,
    ms: number,
    { key }: RestateClientCallOptions = {},
  ): Promise<void> {
    assertArgs({ keyed }, { key });
    assert<integer & PositiveNoZero>(ms);

    throw new Error('Unimplemented');
  }
}
