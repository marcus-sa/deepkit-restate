import * as restate from '@restatedev/restate-sdk';
import { BSONDeserializer, BSONSerializer } from '@deepkit/bson';
import {
  integer,
  PositiveNoZero,
  ReceiveType,
  uuid,
  assert,
  resolveReceiveType,
  Type,
  uint8,
} from '@deepkit/type';

import { deserializeSagaState, SagaState } from './saga/saga-instance.js';
import {
  assertArgs,
  createServiceProxy,
  decodeRestateServiceMethodResponse,
  getSagaDataSerializer,
  getRestateSagaName,
  getSagaDataDeserializer,
} from './utils.js';
import {
  RestateServiceMethodRequest,
  RestateService,
  RestateClientCallOptions,
  RestateApiInvocation,
  RestateRpcResponse,
  RestateKeyedService,
  RestateSaga,
} from './types.js';

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

export class RestateSagaClient<Data> {
  private readonly serializeData: BSONSerializer;
  private readonly deserializeData: BSONDeserializer<Data>;
  private readonly serviceName: string;
  private readonly server: restate.clients.RestateClient;

  constructor(
    private readonly client: RestateClient,
    private readonly type: Type,
  ) {
    this.serializeData = getSagaDataSerializer(this.type);
    this.deserializeData = getSagaDataDeserializer<Data>(this.type);
    this.serviceName = getRestateSagaName(this.type);
    this.server = restate.clients.connect(this.client.url);
  }

  async state(id: string): Promise<SagaState<Data>> {
    const { client } = await this.server.connectToWorkflow(
      this.serviceName,
      id,
    );

    const result = (await (client.workflowInterface() as any)['state']()) as
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

  async status(id: string): Promise<restate.workflow.LifecycleStatus> {
    const { status } = await this.server.connectToWorkflow(
      this.serviceName,
      id,
    );
    return status;
  }

  async start(
    id: string,
    data: Data,
  ): Promise<restate.workflow.WorkflowStartResult> {
    const request = Array.from(this.serializeData(data));
    const { status } = await this.server.submitWorkflow(this.serviceName, id, {
      request,
    });
    return status;
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

  saga<T extends RestateSaga<string, any>>(
    type?: ReceiveType<T>,
  ): RestateSagaClient<T['data']> {
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
    }: RestateServiceMethodRequest<R, A>,
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

    return decodeRestateServiceMethodResponse(
      new Uint8Array(result.response),
      deserializeReturn,
      entities,
    );
  }

  async send<R, A extends any[]>(
    { service, method, data, keyed }: RestateServiceMethodRequest<R, A>,
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
    { service, method, data, keyed }: RestateServiceMethodRequest<R, A>,
    ms: number,
    { key }: RestateClientCallOptions = {},
  ): Promise<void> {
    assertArgs({ keyed }, { key });
    assert<integer & PositiveNoZero>(ms);

    throw new Error('Unimplemented');
  }
}
