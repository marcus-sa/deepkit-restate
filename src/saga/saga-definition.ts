import { TerminalError } from '@restatedev/restate-sdk';
import { typeSettings } from '@deepkit/type';
import { deserializeBSON } from '@deepkit/bson';

import { SagaStep } from './saga-step.js';
import { SagaExecutionState } from './saga-execution-state.js';
import { StepToExecute } from './step-to-execute.js';
import { SagaInstance } from './saga-instance.js';
import { SagaActions } from './saga-actions.js';
import { deserializeRestateTerminalErrorType } from '../serializer.js';
import {
  RestateHandlerRequest,
  RestateHandlerResponse,
  restateTerminalErrorType,
} from '../types.js';

export class SagaDefinition<Data> {
  constructor(readonly steps: readonly SagaStep<Data>[]) {}

  private async nextStepToExecute(
    { compensating, currentlyExecuting }: SagaExecutionState,
    data: Data,
  ): Promise<StepToExecute<Data>> {
    const direction = compensating ? -1 : +1;
    let skipped = 0;

    for (
      let i = currentlyExecuting + direction;
      i >= 0 && i < this.steps.length;
      i = i + direction
    ) {
      const step = this.steps[i];
      if (
        compensating
          ? await step.hasCompensation(data)
          : await step.hasAction(data)
      ) {
        return new StepToExecute<Data>(skipped, compensating, step);
      } else {
        skipped++;
      }
    }

    return new StepToExecute<Data>(skipped, compensating);
  }

  private async executeNextStep(
    sagaData: Data,
    currentState: SagaExecutionState,
  ): Promise<SagaActions<Data>> {
    const stepToExecute = await this.nextStepToExecute(currentState, sagaData);

    return stepToExecute.isEmpty()
      ? SagaActions.makeEndState(currentState)
      : await stepToExecute.executeStep(sagaData, currentState);
  }

  async start(instance: SagaInstance<Data>): Promise<SagaActions<Data>> {
    return this.executeNextStep(instance.sagaData, instance.currentState);
  }

  async handleReply(
    state: SagaExecutionState,
    sagaData: Data,
    request: RestateHandlerRequest,
    response: RestateHandlerResponse,
    afterHandler?: () => void,
  ): Promise<SagaActions<Data>> {
    const currentStep = this.steps[state.currentlyExecuting];
    if (!currentStep) {
      throw new TerminalError(
        `Saga step is missing for execution state ${state}`,
      );
    }
    const reply = currentStep.getReply(response, state.compensating);
    if (reply) {
      const replyData = this.deserializeReply(request, response);
      await reply.handler(sagaData, replyData);
      afterHandler?.();
    }

    return await this.handleActions(state, sagaData, response.success);
  }

  private deserializeReply<T>(
    request: RestateHandlerRequest,
    response: RestateHandlerResponse,
  ): T | TerminalError {
    if (!response.typeName) {
      throw new TerminalError('Missing type name', {
        errorCode: 400,
      });
    }
    if (!response.data) {
      throw new TerminalError(`Missing reply data for ${response.typeName}`, {
        errorCode: 400,
      });
    }
    if (response.success) {
      return request.deserializeReturn(response.data);
    }
    const entity =
      request.entities.get(response.typeName) ||
      typeSettings.registeredEntities[response.typeName];
    if (!entity) {
      if (response.typeName === restateTerminalErrorType.typeName) {
        return deserializeRestateTerminalErrorType(response.data);
      }
      throw new TerminalError(`Missing entity for reply ${response.typeName}`, {
        errorCode: 500,
      });
    }
    return deserializeBSON<T>(response.data, undefined, undefined, entity);
  }

  async handleActions(
    state: SagaExecutionState,
    sagaData: Data,
    success: boolean,
  ): Promise<SagaActions<Data>> {
    if (success) {
      return await this.executeNextStep(sagaData, state);
    } else if (state.compensating) {
      throw new TerminalError('Failure when compensating');
    } else {
      return await this.executeNextStep(sagaData, state.startCompensating());
    }
  }
}
