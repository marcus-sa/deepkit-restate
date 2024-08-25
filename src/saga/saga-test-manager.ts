import { ClassType } from '@deepkit/core';

import { getRestateSagaMetadata, success } from '../utils.js';
import { SagaExecutionState } from './saga-execution-state.js';
import { SagaManager } from './saga-manager.js';
import { Saga } from './saga.js';
import { SagaInstance } from './saga-instance.js';
import {
  RestateHandlerRequest,
  RestateHandlerResponse,
  RestateSagaContext,
} from '../types.js';
import { RestateSagaMetadata } from '../decorator.js';

type ReplyHandler<Data> = (data: Data, state: SagaExecutionState) => void;

type InvokeHandler<D> = (data: D) => RestateHandlerResponse;

type CompensateHandler<D> = (data: D) => RestateHandlerResponse;

interface MockHandler<D> {
  readonly mock: InvokeHandler<D>;
  readonly name: string;
  called: boolean;
}

interface ReplyAssertHandler<D> {
  readonly assert: ReplyHandler<D>;
  readonly name: string;
  called: boolean;
}

export class SagaTestManager<D, S extends Saga<D>> extends SagaManager<D> {
  readonly invokers: MockHandler<D>[] = [];
  readonly compensators: MockHandler<D>[] = [];
  readonly replies = new Map<string, ReplyAssertHandler<D>>();

  constructor(ctx: RestateSagaContext, saga: S) {
    const metadata = getRestateSagaMetadata<D>(saga.constructor as ClassType)!;

    const origHandleReply = saga.definition.handleReply.bind(saga.definition);

    const definition = Object.assign(
      saga.definition,
      {
        handleReply: async (
          ctx: RestateSagaContext,
          state: SagaExecutionState,
          data: D,
          request: RestateHandlerRequest,
          response: RestateHandlerResponse,
        ) => {
          const actions = await origHandleReply(
            ctx,
            state,
            data,
            request,
            response,
          );
          if (response.typeName) {
            const reply = this.replies.get(response.typeName);
            if (reply) {
              try {
                reply.assert(data, state);
              } finally {
                reply.called = true;
              }
            }
          }
          return actions;
        },
      },
    );
    Object.assign(saga, { definition });

    super(ctx, saga, metadata);
  }

  protected override async invokeParticipant(
    instance: SagaInstance<D>,
    { service, method, data }: RestateHandlerRequest,
  ): Promise<RestateHandlerResponse> {
    const handler= instance.currentState.compensating
      ? this.compensators[instance.currentState.currentlyExecuting]
      : this.invokers[instance.currentState.currentlyExecuting];
    if (!handler) return success();
    try {
      return handler.mock(instance.sagaData);
    } finally {
      handler.called = true;
    }
  }

  mockInvocation<K extends keyof S>(method: K, mock: InvokeHandler<D>) {
    const stepIndex = this.saga.definition.steps
      .filter(step => step.isParticipantInvocation && step.invoke)
      .findIndex(step => {
        const stepName = (step.invoke as Function).name.replace('bound ', '');
        return stepName === method;
      });

    if (stepIndex < 0) {
      throw new Error(`Unable to find invoke step ${method as string}`);
    }

    this.invokers[stepIndex] = { mock, name: method as string, called: false };
  }

  mockCompensation<K extends keyof S>(
    method: K,
    mock: CompensateHandler<D>,
  ) {
    const stepIndex = this.saga.definition.steps
      .filter(step => step.isParticipantInvocation && step.compensate)
      .findIndex(step => {
        const stepName = (step.compensate as Function).name.replace('bound ', '');
        return stepName === method;
      });

    if (stepIndex < 0) {
      throw new Error(`Unable to find compensate step ${method as string}`);
    }

    this.compensators[stepIndex] = { mock, name: method as string, called: false };
  }

  assertReply<K extends keyof S>(method: K, assert: ReplyHandler<D>) {
    for (const step of this.saga.definition.steps) {
      const handlers = [...step.actionReplyHandlers.values(), ...step.compensationReplyHandlers.values()];

      const handler = handlers.find(handler => {
        const handlerName = handler.handler.name.replace('bound ', '');
        return handlerName === method;
      });

      if (handler) {
        this.replies.set(handler.type.typeName!, { name: method as string, called: false, assert });
      }
    }
  }

  waitForInvocationToHaveBeenCalled<K extends keyof S>(method: K, timeout: number = 1000): Promise<void> {
     return new Promise((resolve, reject) => {
       let wait = true;

       setTimeout(() => {
         wait = false;
         reject();
       }, timeout);

       const invoker = this.invokers.find(invoker => invoker.name === method);
       if (!invoker) {
         throw new Error(`Unable to find invoke method ${method as string}`);
       }

       while (wait) {
         if (invoker?.called) {
           wait = false;
           resolve();
         }
       }
     });
  }

  waitForCompensationToHaveBeenCalled<K extends keyof S>(method: K, timeout: number = 1000): Promise<void> {
    return new Promise((resolve, reject) => {
      let wait = true;

      setTimeout(() => {
        wait = false;
        reject();
      }, timeout);

      const compensator = this.compensators.find(compensator => compensator.name === method);
      if (!compensator) {
        throw new Error(`Unable to find compensate method ${method as string}`);
      }

      while (wait) {
        if (compensator?.called) {
          wait = false;
          resolve();
        }
      }
    });
  }

  assertMocksHaveBeenCalled() {
    for (const handler of this.invokers) {
      if (!handler.called) {
        throw new Error(`Invoke handler ${handler.name} wasn't called`);
      }
    }
    for (const handler of this.compensators) {
      if (!handler.called) {
        throw new Error(`Compensate handler ${handler.name} wasn't called`);
      }
    }
    for (const handler of this.replies.values()) {
      if (!handler.called) {
        throw new Error(`Reply handler ${handler.name} wasn't called`);
      }
    }
  }
}

