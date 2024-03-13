import { Type, typeOf, uint8 } from '@deepkit/type';
import { SharedWfContext } from '@restatedev/restate-sdk/dist/workflows/workflow';
import { SagaExecutionState } from './saga-execution-state';
import {
  bsonBinarySerializer,
  getBSONDeserializer,
  getBSONSerializer,
} from '@deepkit/bson';
import { RestateSagaMetadata } from '../decorator';
import { RestateSagaContext } from '../types';

export class SagaInstance<Data> {
  constructor(
    public sagaData: Data,
    public currentState: SagaExecutionState = new SagaExecutionState(),
  ) {}

  async restore(
    ctx: RestateSagaContext | SharedWfContext,
    metadata: RestateSagaMetadata<Data>,
  ): Promise<SagaInstance<Data>> {
    const ctxData = await ctx.get<readonly uint8[]>(SAGA_INSTANCE_STATE_KEY);
    if (!ctxData) return this;
    const sagaData = new Uint8Array(ctxData);
    const instance = deserializeSagaInstance(sagaData) as SagaInstance<Data>;
    instance.sagaData = metadata.deserializeData(
      new Uint8Array(instance.sagaData as readonly uint8[]),
    );
    return instance;
  }

  save(ctx: RestateSagaContext, metadata: RestateSagaMetadata): void {
    ctx.set(
      SAGA_INSTANCE_STATE_KEY,
      Array.from(
        serializeSagaInstance(
          new SagaInstance(
            metadata.serializeData(this.sagaData as Uint8Array),
            this.currentState,
          ),
        ),
      ),
    );
  }
}

export const sagaInstanceType = typeOf<SagaInstance<readonly uint8[]>>();

export const SAGA_INSTANCE_STATE_KEY = '__instance';

export const serializeSagaInstance = getBSONSerializer(
  bsonBinarySerializer,
  sagaInstanceType,
);

export const deserializeSagaInstance = getBSONDeserializer<
  SagaInstance<readonly uint8[]>
>(bsonBinarySerializer, sagaInstanceType);
