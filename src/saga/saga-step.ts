import {
  Handler,
  PredicateFn,
  SagaReplyHandler,
  SagaReplyHandlers,
} from './types';
import {
  RestateServiceMethodResponse,
  RestateServiceMethodRequest,
  RestateSagaContext,
} from '../types';

import { SagaStepOutcome } from './step-outcome';

export class SagaStep<Data> {
  constructor(
    readonly invoke: Handler<Data, RestateServiceMethodRequest | void>,
    readonly isParticipantInvocation: boolean,
    readonly compensate?: Handler<Data>,
    readonly compensatePredicate?: PredicateFn<Data>,
    readonly actionReplyHandlers?: SagaReplyHandlers<Data>,
    readonly compensationReplyHandlers?: SagaReplyHandlers<Data>,
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
    response: RestateServiceMethodResponse,
    compensating: boolean,
  ): SagaReplyHandler<Data, T> | undefined {
    const replyHandlers = compensating
      ? this.compensationReplyHandlers
      : this.actionReplyHandlers;

    return replyHandlers?.get(response.typeName);
  }

  async createStepOutcome(
    ctx: RestateSagaContext,
    data: Data,
    compensating: boolean,
  ): Promise<SagaStepOutcome> {
    if (this.isParticipantInvocation) {
      return SagaStepOutcome.forParticipant(
        !compensating
          ? await this.invoke?.(data)
          : await this.compensate?.(data),
      );
    } else {
      try {
        await ctx.sideEffect(async () => {
          if (!compensating) {
            await this.invoke?.(data);
          } else {
            await this.compensate?.(data);
          }
        });
        return SagaStepOutcome.forLocal();
      } catch (err) {
        return SagaStepOutcome.forLocalWithError(err);
      }
    }
  }
}
