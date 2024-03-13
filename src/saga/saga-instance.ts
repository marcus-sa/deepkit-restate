import { typeOf, uint8 } from '@deepkit/type';
import { SharedWfContext } from '@restatedev/restate-sdk/dist/workflows/workflow';
import { SagaExecutionState } from './saga-execution-state';
import {
  bsonBinarySerializer,
  getBSONDeserializer,
  getBSONSerializer,
} from '@deepkit/bson';
import { RestateSagaMetadata } from '../decorator';
import { RestateSagaContext } from '../types';

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
    ctx: RestateSagaContext | SharedWfContext,
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
        } satisfies SagaState<Uint8Array>),
      ),
    );
  }
}

export const sagaStateType = typeOf<SagaState>();

export const SAGA_STATE_KEY = '__instance';

export const serializeSagaState = getBSONSerializer<SagaState>(
  bsonBinarySerializer,
  sagaStateType,
);

export const deserializeSagaState = getBSONDeserializer<SagaState>(
  bsonBinarySerializer,
  sagaStateType,
);
