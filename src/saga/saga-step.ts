import { Handler, SagaReplyHandlers } from './types';

export class SagaStep<Data> {
  constructor(
    readonly handler: Handler<Data>,
    readonly compensator?: Handler<Data>,
    readonly actionReplyHandlers?: SagaReplyHandlers<Data>,
    readonly compensationReplyHandlers?: SagaReplyHandlers<Data>,
  ) {}
}
