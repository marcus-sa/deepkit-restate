import { TerminalError } from '@restatedev/restate-sdk';

import { Saga } from './saga.js';
import { SagaInstance } from './saga-instance.js';
import { SagaActions } from './saga-actions.js';
import { RestateSagaMetadata } from '../decorator.js';
import {
  deserializeRestateHandlerResponse,
  RestateHandlerRequest,
  RestateHandlerResponse,
  RestateSagaContext,
  restateTerminalErrorType,
  serializeRestateTerminalErrorType,
} from '../types.js';

export class SagaManager<Data> {
  constructor(
    private readonly ctx: RestateSagaContext,
    readonly saga: Saga<Data>,
    private readonly metadata: RestateSagaMetadata<Data>,
  ) {}

  protected async invokeParticipant(
    instance: SagaInstance<Data>,
    { service, method, data }: RestateHandlerRequest,
    // TODO: this has not yet been implemented
    key?: string,
  ): Promise<RestateHandlerResponse> {
    try {
      return await (this.ctx as any).invoke(
        service,
        method,
        data,
        key,
        undefined,
        (response: Uint8Array) => deserializeRestateHandlerResponse(response),
      );
    } catch (err: unknown) {
      // TODO: should terminal errors stop execution?
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

  protected async performEndStateActions(
    compensating: boolean,
    sagaData: Data,
  ): Promise<void> {
    await this.ctx.run(async () => {
      if (compensating) {
        await this.saga.onSagaRolledBack?.(this.ctx.key, sagaData);
      } else {
        await this.saga.onSagaCompletedSuccessfully?.(this.ctx.key, sagaData);
      }
    });
  }

  protected async processActions(
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

        // TODO: this might not be sufficient for restate reruns
        await instance.save(this.ctx, this.metadata);

        if (actions.stepOutcome?.request) {
          const response = await this.invokeParticipant(
            instance,
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
    // TODO: wait for state machine api.
    //  currently we have to rerun everything in the same order to keep the restate journal consistent
    // const instance = await new SagaInstance<Data>(data).restore(
    //   this.ctx,
    //   this.metadata,
    // );
    const instance = new SagaInstance(data);

    await this.ctx.run(async () => {
      await this.saga.onStarting?.(this.ctx.key, instance.sagaData);
    });

    const actions = await this.saga.definition.start(this.ctx, instance);

    await this.processActions(instance, actions);

    return instance;
  }
}
