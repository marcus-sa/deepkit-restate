import { typeOf, uint8 } from '@deepkit/type';
import { WorkflowContext } from '@restatedev/restate-sdk';
import {
  getBSONDeserializer,
  getBSONSerializer,
} from '@deepkit/bson';

import { SagaExecutionState } from './saga-execution-state.js';
import { RestateSagaMetadata } from '../decorator.js';
import { RestateSagaContext } from '../types.js';

export interface SagaState<Data = Uint8Array> {
  readonly sagaData: Data;
  readonly currentState: SagaExecutionState;
}

export class SagaInstance<Data> implements SagaState<Data> {
  constructor(
    public sagaData: Data,
    public currentState: SagaExecutionState = new SagaExecutionState(),
  ) {}

  async restore(
    ctx: RestateSagaContext | WorkflowContext,
    metadata: RestateSagaMetadata<Data>,
  ): Promise<SagaInstance<Data>> {
    const ctxData = await ctx.get<readonly uint8[]>(SAGA_STATE_KEY);
    if (!ctxData) return this;
    const instance = deserializeSagaState(new Uint8Array(ctxData));
    this.sagaData = metadata.deserializeData(instance.sagaData);
    this.currentState = instance.currentState;
    return this;
  }

  async save(
    ctx: RestateSagaContext,
    metadata: RestateSagaMetadata,
  ): Promise<void> {
    ctx.set(
      SAGA_STATE_KEY,
      Array.from(
        serializeSagaState({
          currentState: this.currentState,
          sagaData: metadata.serializeData(this.sagaData),
        } satisfies SagaState),
      ),
    );
  }
}

export const sagaStateType = typeOf<SagaState>();

export const SAGA_STATE_KEY = '__instance__';

export const serializeSagaState = getBSONSerializer<SagaState>(
  undefined,
  sagaStateType,
);

export const deserializeSagaState = getBSONDeserializer<SagaState>(
  undefined,
  sagaStateType,
);
