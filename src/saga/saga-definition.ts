import { TerminalError } from '@restatedev/restate-sdk';

import { SagaStep } from './saga-step';
import { SagaExecutionState } from './saga-execution-state';
import { StepToExecute } from './step-to-execute';
import { SagaInstance } from './saga-instance';
import { SagaActions } from './saga-actions';
import {
  RestateServiceMethodResponse,
  RestateServiceMethodRequest,
  Entity,
  RestateSagaContext,
} from '../types';

export class SagaDefinition<Data> {
  constructor(private readonly steps: readonly SagaStep<Data>[]) {}

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
    ctx: RestateSagaContext,
    sagaData: Data,
    currentState: SagaExecutionState,
  ): Promise<SagaActions<Data>> {
    const stepToExecute = await this.nextStepToExecute(currentState, sagaData);

    return stepToExecute.isEmpty()
      ? SagaActions.makeEndState(currentState)
      : await stepToExecute.executeStep(ctx, sagaData, currentState);
  }

  async start(
    ctx: RestateSagaContext,
    instance: SagaInstance<Data>,
  ): Promise<SagaActions<Data>> {
    return this.executeNextStep(ctx, instance.sagaData, instance.currentState);
  }

  private deserializeReply<T>(
    request: RestateServiceMethodRequest,
    response: RestateServiceMethodResponse,
  ): T {
    if (response.success) {
      return request.deserializeReturn(response.data);
    }
    const entity = request.entities.get(response.typeName) as Entity<T> | null;
    if (!entity) {
      throw new TerminalError(`Missing entity for type ${response.typeName}`);
    }
    return entity.deserialize(response.data);
  }

  async handleReply(
    ctx: RestateSagaContext,
    state: SagaExecutionState,
    sagaData: Data,
    request: RestateServiceMethodRequest,
    response: RestateServiceMethodResponse,
  ): Promise<SagaActions<Data>> {
    if (request) {
      const currentStep = this.steps[state.currentlyExecuting];
      if (!currentStep) {
        throw new TerminalError(
          `Saga step is missing for execution state ${state}`,
        );
      }
      const reply = currentStep.getReply(response, state.compensating);
      if (reply) {
        const replyData = this.deserializeReply(request, response);
        await ctx.sideEffect(async () => reply.handler(sagaData, replyData));
      }
    }

    return await this.handleActions(ctx, state, sagaData, response.success);
  }

  async handleActions(
    ctx: RestateSagaContext,
    state: SagaExecutionState,
    sagaData: Data,
    success: boolean,
  ): Promise<SagaActions<Data>> {
    if (success) {
      return this.executeNextStep(ctx, sagaData, state);
    } else if (state.compensating) {
      throw new TerminalError('Failure when compensating');
    } else {
      return this.executeNextStep(ctx, sagaData, state.startCompensating());
    }
  }
}
