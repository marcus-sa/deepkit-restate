import { serde, TerminalError } from '@restatedev/restate-sdk';

import { Saga } from './saga.js';
import { SagaInstance } from './saga-instance.js';
import { SagaActions } from './saga-actions.js';
import { RestateSagaMetadata } from '../decorator.js';
import {
  deserializeRestateHandlerResponse,
  serializeRestateTerminalErrorType,
} from '../serde.js';
import {
  RestateHandlerRequest,
  RestateHandlerResponse,
  RestateSagaContext,
} from '../types.js';

export class SagaManager<Data> {
  #processActionsPromise?: Promise<void>;

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
      const response = await this.ctx.genericCall({
        service,
        method,
        parameter: data,
        key,
        outputSerde: serde.binary,
      });

      return deserializeRestateHandlerResponse(response);
    } catch (err: unknown) {
      // TODO: should terminal errors stop execution?
      if (err instanceof TerminalError) {
        return {
          success: false,
          data: serializeRestateTerminalErrorType(err),
          typeName: 'TerminalError',
        };
      }
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
          actions.stepOutcome.error,
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

        instance.save();

        if (actions.stepOutcome?.request) {
          const response = await this.invokeParticipant(
            instance,
            actions.stepOutcome.request,
          );
          actions = await this.saga.definition.handleReply(
            instance,
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

  async waitForCompletion(): Promise<void> {
    if (!this.#processActionsPromise) {
      throw new Error('Saga has not been started yet');
    }
    await this.#processActionsPromise;
  }

  async start(data: Data): Promise<SagaInstance<Data>> {
    // TODO: wait for state machine api.
    //  currently we have to rerun everything in the same order to keep the restate journal consistent
    // const instance = await new SagaInstance<Data>(this.ctx, this.metadata, data).restore();
    const instance = new SagaInstance<Data>(this.ctx, this.metadata, data);

    await this.saga.onStarting?.(instance.sagaData);

    const actions = await this.saga.definition.start(instance);

    this.#processActionsPromise = this.processActions(instance, actions);

    return instance;
  }
}
