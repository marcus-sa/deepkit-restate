import { TerminalError } from '@restatedev/restate-sdk';

import { Saga } from './saga.js';
import { SagaInstance } from './saga-instance.js';
import { SagaActions } from './saga-actions.js';
import { RestateSagaMetadata } from '../decorator.js';
import {
  RestateHandlerRequest,
  RestateHandlerResponse,
  RestateSagaContext,
  restateTerminalErrorType,

} from '../types.js';
import { deserializeRestateHandlerResponse, serializeRestateTerminalErrorType } from '../serializer.js';

export class SagaManager<Data> {
  constructor(
    protected readonly ctx: RestateSagaContext,
    protected readonly saga: Saga<Data>,
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
    if (compensating) {
      await this.saga.onSagaRolledBack?.(sagaData);
    } else {
      await this.saga.onSagaCompletedSuccessfully?.(sagaData);
    }
  }

  protected async processActions(
    instance: SagaInstance<Data>,
    actions: SagaActions<Data>,
  ): Promise<void> {
    while (true) {
      if (actions.stepOutcome?.error) {
        actions = await this.saga.definition.handleActions(
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
            instance.currentState,
            instance.sagaData,
            actions.stepOutcome.request,
            response,
          );
        } else {
          if (!actions.stepOutcome?.local) break;

          actions = await this.saga.definition.handleActions(
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

    await this.saga.onStarting?.(instance.sagaData);

    const actions = await this.saga.definition.start(instance);

    void this.processActions(instance, actions);

    return instance;
  }
}
