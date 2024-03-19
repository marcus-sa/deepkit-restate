import { TerminalError } from '@restatedev/restate-sdk';
import { RpcResponse } from '@restatedev/restate-sdk/dist/generated/proto/dynrpc.js';

import { Saga } from './saga.js';
import { SagaInstance } from './saga-instance.js';
import { SagaActions } from './saga-actions.js';
import { RestateSagaMetadata } from '../decorator.js';
import { assertArgs, encodeRpcRequest } from '../utils.js';
import {
  deserializeRestateServiceMethodResponse,
  RestateClientCallOptions,
  RestateSagaContext,
  RestateServiceMethodRequest,
  RestateServiceMethodResponse,
  restateTerminalErrorType,
  serializeRestateTerminalErrorType,
} from '../types.js';

export class SagaManager<Data> {
  constructor(
    private readonly ctx: RestateSagaContext,
    private readonly saga: Saga<Data>,
    private readonly metadata: RestateSagaMetadata<Data>,
  ) {}

  private async invokeParticipant(
    { service, method, data, keyed }: RestateServiceMethodRequest,
    { key }: RestateClientCallOptions = {},
  ): Promise<RestateServiceMethodResponse> {
    try {
      assertArgs({ keyed }, { key });
      return await (this.ctx as any).ctx
        .invoke(service, method, encodeRpcRequest(data, key))
        .transform((response: Uint8Array) =>
          deserializeRestateServiceMethodResponse(
            new Uint8Array(RpcResponse.decode(response).response),
          ),
        );
    } catch (err: unknown) {
      if (err instanceof TerminalError) {
        return {
          success: false,
          data: serializeRestateTerminalErrorType(err),
          typeName: restateTerminalErrorType.typeName!,
        };
      }
      // TODO: what to do with unhandled errors?
      throw err;
    }
  }

  private async performEndStateActions(
    compensating: boolean,
    sagaData: Data,
  ): Promise<void> {
    if (compensating) {
      await this.ctx.sideEffect(async () => {
        await this.saga.onSagaRolledBack?.(this.ctx.workflowId(), sagaData);
      });
    } else {
      await this.ctx.sideEffect(async () => {
        await this.saga.onSagaCompletedSuccessfully?.(
          this.ctx.workflowId(),
          sagaData,
        );
      });
    }
  }

  private async processActions(
    instance: SagaInstance<Data>,
    actions: SagaActions<Data>,
  ): Promise<void> {
    while (true) {
      if (actions.stepOutcome?.error) {
        actions = await this.saga.definition.handleActions(
          this.ctx,
          actions.updatedState!,
          actions.updatedData!,
          false,
        );
      } else {
        if (actions.updatedState) {
          instance.currentState = actions.updatedState;
        }
        if (actions.updatedData) {
          instance.sagaData = actions.updatedData;
        }

        if (actions.endState) {
          await this.performEndStateActions(
            actions.compensating,
            instance.sagaData,
          );
        }

        await instance.save(this.ctx, this.metadata);

        if (actions.stepOutcome?.request) {
          const response = await this.invokeParticipant(
            actions.stepOutcome.request,
          );
          actions = await this.saga.definition.handleReply(
            this.ctx,
            instance.currentState,
            instance.sagaData,
            actions.stepOutcome.request,
            response,
          );
        } else {
          if (!actions.stepOutcome?.local) break;

          actions = await this.saga.definition.handleActions(
            this.ctx,
            actions.updatedState!,
            actions.updatedData!,
            true,
          );
        }
      }
    }
  }

  async start(data: Data): Promise<SagaInstance<Data>> {
    const instance = await new SagaInstance<Data>(data).restore(
      this.ctx,
      this.metadata,
    );

    await this.ctx.sideEffect(async () => {
      await this.saga.onStarting?.(this.ctx.workflowId(), instance.sagaData);
    });

    const actions = await this.saga.definition.start(this.ctx, instance);

    await this.processActions(instance, actions);

    return instance;
  }
}
