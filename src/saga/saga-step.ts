import { Handler, SagaReplyHandler, SagaReplyHandlers } from './types';
import { InternalResponse, RestateServiceMethodCall } from '../types';

export class SagaStep<Data> {
  constructor(
    readonly handler: Handler<Data, RestateServiceMethodCall | void>,
    readonly compensator?: Handler<Data>,
    readonly actionReplyHandlers?: SagaReplyHandlers<Data>,
    readonly compensationReplyHandlers?: SagaReplyHandlers<Data>,
  ) {}

  async hasAction(data: Data): Promise<boolean> {
    return true;
  }

  async compensates(data: Data): Promise<boolean> {
    return this.compensator?.(data);
  }

  getReply<T>(
    response: InternalResponse,
    compensating: boolean,
  ): SagaReplyHandler<Data, T> | undefined {
    const replyHandlers = compensating
      ? this.compensationReplyHandlers
      : this.actionReplyHandlers;

    return replyHandlers?.get(response.typeName);
  }

  isSuccessfulReply(compensating: boolean, response: InternalResponse): boolean {
    return response.success;
  }

  async createStepOutcome(
    data: Data,
    compensating: boolean,
  ): Promise<RestateServiceMethodCall | void> {
    if (!compensating) {
      return await this.handler(data);
    }
    await this.compensator?.(data);
  }
}
