import { ReceiveType, ReflectionKind, resolveReceiveType } from '@deepkit/type';

import { RestateHandlerRequest } from '../types.js';
import { SagaDefinitionBuilder } from './saga-definition-builder.js';
import { SagaStep } from './saga-step.js';
import { Handler, PredicateFn, SagaReplyHandlerFn, SagaReplyHandlers } from './types.js';
import { SagaDefinition } from './saga-definition.js';

export interface BaseStepBuilder<Data> {
  step(): StepBuilder<Data>;
  build(): SagaDefinition<Data>;
}

export interface LocalStepBuilder<Data> extends BaseStepBuilder<Data> {
  // TODO: allow participants to be invoked
  compensate(handler: Handler<Data>): this;
}

export interface ParticipantStepBuilder<Data> extends BaseStepBuilder<Data> {
  onReply<T>(
    handler: (data: Data, reply: T) => Promise<void> | void,
    type?: ReceiveType<T>,
  ): this;

  // TODO: allow participants to be invoked
  compensate(handler: Handler<Data>, predicate?: PredicateFn<Data>): this;
}

class InvokedStepBuilder<Data>
  implements ParticipantStepBuilder<Data>, LocalStepBuilder<Data>
{
  private readonly actionReplyHandlers: SagaReplyHandlers<Data> = new Map();
  private readonly compensationReplyHandlers: SagaReplyHandlers<Data> =
    new Map();
  private compensator?: Handler<Data>;
  private compensationPredictor?: Handler<Data>;

  constructor(
    private readonly builder: SagaDefinitionBuilder<Data>,
    private readonly handler: Handler<Data>,
    private readonly isParticipantInvocation: boolean,
  ) {}

  private addStep(): void {
    this.builder.addStep(
      new SagaStep<Data>(
        this.handler.bind(this.builder.saga),
        this.isParticipantInvocation,
        this.compensator,
        this.compensationPredictor,
        this.actionReplyHandlers,
        this.compensationReplyHandlers,
      ),
    );
  }

  compensate(handler: Handler<Data>, predicate?: PredicateFn<Data>): this {
    this.compensator = handler.bind(this.builder.saga);
    if (predicate) {
      this.compensationPredictor = predicate.bind(this.builder.saga);
    }
    return this;
  }

  // TODO: should we differentiate between replies and errors? e.g onError and onReply
  onReply<T>(
    handler: SagaReplyHandlerFn<Data, T>,
    type?: ReceiveType<T>,
  ): this {
    handler = handler.bind(this.builder.saga);
    type = resolveReceiveType(type);
    if (
      type.kind !== ReflectionKind.class &&
      type.kind !== ReflectionKind.objectLiteral
    ) {
      throw new Error('Only classes and interfaces are supported');
    }

    if (this.compensator) {
      this.compensationReplyHandlers.set(type.typeName!, { type, handler });
    } else {
      this.actionReplyHandlers.set(type.typeName!, { type, handler });
    }

    return this;
  }

  step(): StepBuilder<Data> {
    this.addStep();
    return new StepBuilder<Data>(this.builder);
  }

  build(): SagaDefinition<Data> {
    this.addStep();
    return this.builder.build();
  }
}

const RETURN_REGEX =
  /(?:function[^{]+|[\w$]+\s*\(.*?\))\s*{[^}]*\breturn\b[^}]*}/;

export class StepBuilder<Data> {
  constructor(private readonly builder: SagaDefinitionBuilder<Data>) {}

  invoke<R, A extends any[]>(
    // TODO: support objects. services are currently only supported because there's no way to provide a key with nice dx
    handler: Handler<Data, RestateHandlerRequest<R, A, 'service'>>,
  ): ParticipantStepBuilder<Data>;
  invoke(handler: Handler<Data, void>): LocalStepBuilder<Data>;
  invoke<T>(
    handler: Handler<Data, T>,
  ): ParticipantStepBuilder<Data> | LocalStepBuilder<Data> {
    /**
     * Deepkit doesn't support inferring types or method overloading,
     * so we have to use an alternative approach to detect if it's a participant invocation.
     * We can "safely" rely on this regex because local invocations aren't allowed to return anything.
     */
    const isParticipantInvocation = RETURN_REGEX.test(handler.toString());
    return new InvokedStepBuilder<Data>(
      this.builder,
      handler,
      isParticipantInvocation,
    );
  }
}
