import { deserialize, ReceiveType, serializer, uuid } from '@deepkit/type';

import { createServiceProxy } from './utils';
import { RestateServiceMethodCall, RestateService } from './types';

export interface RestateClientOptions {
  // Not implemented (see https://discord.com/channels/1128210118216007792/1214635273141616761/1214932617435156510)
  // readonly authToken: string;
}

export interface RestateClientCallOptions {
  readonly key?: string | number;
}

interface RestateApiError {
  readonly code: string;
  readonly message: string;
}

class RestateApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function isRestateApiError(value: any): value is RestateApiError {
  return 'code' in value;
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
    if (keyed && key == null) {
      throw new Error('Missing key for keyed service');
    }
    if (key != null && !keyed) {
      throw new Error('Unnecessary key for unkeyed service');
    }

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
      | RestateApiError
      | { readonly response: R };
    if (isRestateApiError(result)) {
      throw new RestateApiError(result.code, result.message);
    }

    return deserialize(
      result.response,
      undefined,
      serializer,
      undefined,
      returnType,
    );
  }

  async send(
    { service, method, args }: RestateServiceMethodCall,
    { key }: RestateClientCallOptions = {},
  ): Promise<string> {
    const result = await fetch(`${this.url}/dev.restate.Ingress/Invoke`, {
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': key != null ? key.toString() : uuid(),
        // Authorization: `Bearer ${this.options.authToken}`,
      },
      body: JSON.stringify({
        service,
        method,
        argument: args,
      }),
    });
    console.log(await result.json());
    return ''; // TODO: return invocation id
  }

  async sendDelayed(
    call: RestateServiceMethodCall,
    ms: number,
    { key }: RestateClientCallOptions = {},
  ): Promise<void> {
    throw new Error('Unimplemented');
  }
}
