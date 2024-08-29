import { Excluded, typeOf, uint8 } from '@deepkit/type';
import { WorkflowContext } from '@restatedev/restate-sdk';
import { getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';

import { SagaExecutionState } from './saga-execution-state.js';
import { RestateSagaMetadata } from '../decorator.js';
import { RestateSagaContext } from '../types.js';

export interface SagaState<Data = Uint8Array> {
  readonly sagaData: Data;
  readonly currentState: SagaExecutionState;
}

export class SagaInstance<Data> implements SagaState<Data> {
  constructor(
    private readonly ctx: RestateSagaContext & Excluded,
    private readonly metadata: RestateSagaMetadata & Excluded,
    public sagaData: Data,
    public currentState: SagaExecutionState = new SagaExecutionState(),
  ) {}

  async restore(
    ctx: RestateSagaContext | WorkflowContext,
    metadata: RestateSagaMetadata<Data>,
  ): Promise<SagaInstance<Data>> {
    const state = await ctx.get<SagaState>(SAGA_STATE_KEY);
    if (!state) return this;
    this.sagaData = metadata.deserializeData(state.sagaData);
    this.currentState = state.currentState;
    return this;
  }

  save(): void {
    this.ctx.set<SagaState>(SAGA_STATE_KEY, {
      currentState: this.currentState,
      sagaData: this.metadata.serializeData(this.sagaData),
    });
  }
}

export const sagaStateType = typeOf<SagaState>();

export const SAGA_STATE_KEY = 'instance';

export const serializeSagaState = getBSONSerializer<SagaState>(
  undefined,
  sagaStateType,
);

export const deserializeSagaState = getBSONDeserializer<SagaState>(
  undefined,
  sagaStateType,
);
