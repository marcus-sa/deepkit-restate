import {
  RestateHandlerRequest,
  RestateHandlerResponse,
  RestateSagaContext,
} from '../types.js';
import {
  Handler,
  PredicateFn,
  SagaReplyHandler,
  SagaReplyHandlers,
} from './types.js';

import { SagaStepOutcome } from './step-outcome.js';

export class SagaStep<Data> {
  constructor(
    readonly isParticipantInvocation: boolean,
    readonly actionReplyHandlers: SagaReplyHandlers<Data>,
    readonly compensationReplyHandlers: SagaReplyHandlers<Data>,
    // readonly awakeables: SagaStepAwakeable,
    readonly invoke?: Handler<Data, RestateHandlerRequest | void>,
    readonly compensate?: Handler<Data>,
    readonly compensatePredicate?: PredicateFn<Data>,
  ) {}

  async hasAction(data: Data): Promise<boolean> {
    return typeof this.invoke === 'function';
  }

  async hasCompensation(data: Data): Promise<boolean> {
    return typeof this.compensatePredicate === 'function'
      ? await this.compensatePredicate(data)
      : typeof this.compensate === 'function';
  }

  getReply<T>(
    response: RestateHandlerResponse,
    compensating: boolean,
  ): SagaReplyHandler<Data, T> | undefined {
    const replyHandlers = compensating
      ? this.compensationReplyHandlers
      : this.actionReplyHandlers;

    return replyHandlers.get(response.typeName!);
  }

  async createStepOutcome(
    data: Data,
    compensating: boolean,
  ): Promise<SagaStepOutcome> {
    if (this.isParticipantInvocation) {
      try {
        const request = !compensating
          ? await this.invoke?.(data)
          : await this.compensate?.(data);

        return SagaStepOutcome.forParticipant(request);
      } catch (err) {
        return SagaStepOutcome.forParticipantWithError(err);
      }
    } else {
      try {
        if (!compensating) {
          await this.invoke?.(data);
        } else {
          await this.compensate?.(data);
        }
        return SagaStepOutcome.forLocal();
      } catch (err) {
        return SagaStepOutcome.forLocalWithError(err);
      }
    }
  }
}
