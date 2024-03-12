import {
  ReceiveType,
  ReflectionFunction,
  ReflectionKind,
  resolveReceiveType,
} from '@deepkit/type';

import { RestateServiceMethodCall } from '../types';
import { SagaDefinitionBuilder } from './saga-definition-builder';
import { SagaStep } from './saga-step';
import { Handler, SagaReplyHandlerFn, SagaReplyHandlers, PredicateFn } from './types';
import { SagaDefinition } from './saga-definition';

export interface BaseStepBuilder<Data> {
  step(): StepBuilder<Data>;
  build(): SagaDefinition<Data>;
}

export interface LocalStepBuilder<Data> extends BaseStepBuilder<Data> {
  compensate(handler: Handler<Data>): this;
}

export interface ParticipantStepBuilder<Data> extends BaseStepBuilder<Data> {
  onReply<T>(
    handler: (data: Data, reply: T) => Promise<void> | void,
    type?: ReceiveType<T>,
  ): this;
  compensate(handler: Handler<Data>, predicate?: PredicateFn<Data>): this;
}

class InvokedStepBuilder<Data>
  implements ParticipantStepBuilder<Data>, LocalStepBuilder<Data>
{
  private readonly actionReplyHandlers: SagaReplyHandlers<Data> = new Map();
  private readonly compensationReplyHandlers: SagaReplyHandlers<Data> =
    new Map();
  private compensator?: Handler<Data>;

  constructor(
    private readonly builder: SagaDefinitionBuilder<Data>,
    private readonly handler: Handler<Data>,
  ) {}

  private addStep(): void {
    this.builder.addStep(
      new SagaStep<Data>(
        this.handler.bind(this.builder.saga),
        this.compensator,
        this.actionReplyHandlers,
        this.compensationReplyHandlers,
      ),
    );
  }

  compensate(handler: Handler<Data>): this {
    this.compensator = handler.bind(this.builder.saga);
    return this;
  }

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

export class StepBuilder<Data> {
  constructor(private readonly builder: SagaDefinitionBuilder<Data>) {}

  invoke<R, A extends any[]>(
    handler: Handler<Data, RestateServiceMethodCall<R, A>>,
  ): ParticipantStepBuilder<Data>;
  invoke<T>(handler: Handler<Data, T>): LocalStepBuilder<Data>;
  invoke(
    handler: Handler<Data>,
  ): ParticipantStepBuilder<Data> | LocalStepBuilder<Data> {
    return new InvokedStepBuilder<Data>(this.builder, handler);
  }
}
