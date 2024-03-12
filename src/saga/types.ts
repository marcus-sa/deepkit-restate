import { TypeClass, TypeObjectLiteral } from '@deepkit/type';

export type Handler<T, R = any, A extends unknown[] = unknown[]> = AsyncLikeFn<
  [data: T, ...args: A],
  R
>;

export type AsyncLikeFn<T extends any[] = any[], R = unknown> = (
  ...args: T
) => AsyncLike<R>;

export type AsyncLike<R> = Promise<R> | R;

export type SagaReplyHandlerFn<Data, Reply> = AsyncLikeFn<
  [data: Data, reply: Reply],
  void
>;

export interface SagaReplyHandler<Data, Reply> {
  readonly type: TypeClass | TypeObjectLiteral;
  readonly handler: SagaReplyHandlerFn<Data, Reply>;
}

export type SagaReplyHandlers<Data> = Map<string, SagaReplyHandler<Data, any>>;
