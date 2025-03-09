import { ClassType } from '@deepkit/core';
import { integer } from '@deepkit/type';

import { RestateSagaContext } from '../context.js';
import { RestateHandlerRequest, RestateHandlerResponse } from '../types.js';
import { getRestateSagaMetadata } from '../utils/type.js';
import { SagaExecutionState } from './saga-execution-state.js';
import { SagaInstance } from './saga-instance.js';
import { SagaManager } from './saga-manager.js';
import { Saga } from './saga.js';
import {success} from "./utils.js";
import {waitUntil} from "../utils/wait-until.js";

type ReplyHandler<Data> = (data: Data, state: SagaExecutionState) => void;

type InvokeHandler<D> = (data: D) => RestateHandlerResponse;

type CompensateHandler<D> = (data: D) => RestateHandlerResponse;

interface MockResponseHandler<D, S> {
  readonly response: InvokeHandler<D>;
  readonly name: keyof S;
  called: boolean;
}

interface RunAfterReplyHandler<D, S> {
  readonly handle: ReplyHandler<D>;
  readonly name: keyof S;
  called: boolean;
}

export class SagaTestManager<D, S extends Saga<D>> extends SagaManager<D> {
  readonly invokers: (MockResponseHandler<D, S> | undefined)[] = [];
  readonly compensators: (MockResponseHandler<D, S> | undefined)[] = [];
  readonly replies = new Map<string, RunAfterReplyHandler<D, S>>();

  constructor(ctx: RestateSagaContext, saga: S) {
    const metadata = getRestateSagaMetadata<D>(saga.constructor as ClassType)!;

    const handleReply = saga.definition.handleReply.bind(saga.definition);

    const definition = Object.assign(saga.definition, {
      handleReply: async (
        instance: SagaInstance<D>,
        request: RestateHandlerRequest,
        response: RestateHandlerResponse,
      ) => {
        return await handleReply(instance, request, response, () => {
          const reply = this.replies.get(response.typeName!);
          if (reply) {
            try {
              reply.handle(instance.sagaData, instance.currentState);
            } finally {
              reply.called = true;
            }
          }
        });
      },
    });
    Object.assign(saga, { definition });

    super(ctx, saga, metadata);
  }

  protected override async invokeParticipant(
    instance: SagaInstance<D>,
  ): Promise<RestateHandlerResponse> {
    const handler = instance.currentState.compensating
      ? this.compensators[instance.currentState.currentlyExecuting]
      : this.invokers[instance.currentState.currentlyExecuting];
    if (!handler) {
      // TODO: determine if each handler should be mocked manually
      return success();
      // throw new Error(
      //   `Missing mock for step at index ${instance.currentState.currentlyExecuting}`,
      // );
    }
    try {
      return handler.response(instance.sagaData);
    } finally {
      handler.called = true;
    }
  }

  mockInvocationResponse<K extends keyof S>(
    method: K,
    response: InvokeHandler<D>,
  ) {
    const stepIndex = this.getInvocationStepIndex(method);
    this.invokers[stepIndex] = { response, name: method, called: false };
  }

  mockCompensationResponse<K extends keyof S>(
    method: K,
    response: CompensateHandler<D>,
  ) {
    const stepIndex = this.getCompensationStepIndex(method);
    this.compensators[stepIndex] = {
      response,
      name: method,
      called: false,
    };
  }

  runAfterReplyHandler<K extends keyof S>(method: K, fn: ReplyHandler<D>) {
    for (const step of this.saga.definition.steps) {
      const handlers = [
        ...step.actionReplyHandlers.values(),
        ...step.compensationReplyHandlers.values(),
      ];

      const handler = handlers.find(handler => {
        const handlerName = handler.handler.name.replace('bound ', '');
        return handlerName === method;
      });

      if (!handler) continue;

      this.replies.set(handler.type.typeName!, {
        name: method,
        called: false,
        handle: fn,
      });
    }
  }

  // TODO
  // runAfterCompensation() {}

  private getCompensationStepIndex<K extends keyof S>(method: K): integer {
    const stepIndex = this.saga.definition.steps.findIndex(step => {
      if (!step.isParticipantInvocation || !step.compensate) return false;
      const stepName = (step.compensate as Function).name.replace('bound ', '');
      return stepName === method;
    });

    if (stepIndex < 0) {
      throw new Error(`Unable to find compensate step ${String(method)}`);
    }

    return stepIndex;
  }

  private getInvocationStepIndex<K extends keyof S>(method: K): integer {
    const stepIndex = this.saga.definition.steps.findIndex(step => {
      if (!step.isParticipantInvocation || !step.invoke) return false;
      const stepName = (step.invoke as Function).name.replace('bound ', '');
      return stepName === method;
    });

    if (stepIndex < 0) {
      throw new Error(`Unable to find invoke step ${String(method)}`);
    }

    return stepIndex;
  }

  // TODO: needs to also be able to run after local invocations
  // runAfterInvocation<K extends keyof S>(method: K, fn: (data: D) => void) {
  //   const stepIndex = this.getInvocationStepIndex(method);
  //   this.invokers[stepIndex] = { response, name: method, called: false };
  // }

  async waitForInvocationToHaveBeenCalled<K extends keyof S>(
    method: K,
    timeout = 1000,
  ): Promise<void> {
    const invoker = this.invokers.find(invoker => invoker?.name === method);
    if (!invoker) {
      throw new Error(`Unable to find invoke method ${String(method)}`);
    }
    await waitUntil(() => invoker.called, timeout);
  }

  async waitForCompensationToHaveBeenCalled<K extends keyof S>(
    method: K,
    timeout = 1000,
  ): Promise<void> {
    const compensator = this.compensators.find(
      compensator => compensator?.name === method,
    );
    if (!compensator) {
      throw new Error(`Unable to find compensate method ${String(method)}`);
    }
    await waitUntil(() => compensator.called, timeout);
  }

  assertHandlersHaveBeenCalled() {
    for (const handler of this.invokers) {
      if (handler && !handler.called) {
        throw new Error(`Invoke handler ${String(handler.name)} wasn't called`);
      }
    }
    for (const handler of this.compensators) {
      if (handler && !handler.called) {
        throw new Error(
          `Compensate handler ${String(handler.name)} wasn't called`,
        );
      }
    }
    for (const handler of this.replies.values()) {
      if (!handler.called) {
        throw new Error(`Reply handler ${String(handler.name)} wasn't called`);
      }
    }
  }

  async waitForHandlersToHaveBeenCalled(timeout = 1000): Promise<void> {
    await Promise.all([
      ...this.invokers
        .filter(invoker => !!invoker)
        .map(invoker =>
          this.waitForInvocationToHaveBeenCalled(invoker!.name, timeout),
        ),
      ...this.compensators
        .filter(compensator => !!compensator)
        .map(compensator =>
          this.waitForCompensationToHaveBeenCalled(compensator!.name, timeout),
        ),
    ]);
    this.assertHandlersHaveBeenCalled();
  }
}
