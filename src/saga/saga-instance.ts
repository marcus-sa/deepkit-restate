import { SagaExecutionState } from './saga-execution-state';
import { Type, typeOf, uint8 } from '@deepkit/type';
import {
  bsonBinarySerializer,
  getBSONDeserializer,
  getBSONSerializer,
} from '@deepkit/bson';
import { RestateSagaMetadata } from '../decorator';
import { RestateSagaContext } from '../types';

export class SagaInstance<Data> {
  static async restore<Data>(
    ctx: RestateSagaContext,
    metadata: RestateSagaMetadata<Data>,
  ): Promise<SagaInstance<Data> | null> {
    const ctxInstance = await ctx.get(sagaInstanceStateKey);
    if (!ctxInstance) return null;
    const data = new Uint8Array(ctxInstance as readonly uint8[]);
    const instance = deserializeSagaInstance(data) as SagaInstance<Data>;
    instance.data = metadata.deserializeData(new Uint8Array(instance.data));
    return instance;
  }

  constructor(
    public data: Data,
    public currentState: SagaExecutionState = new SagaExecutionState(),
  ) {}

  // async restore(ctx: RestateSagaContext, metadata: RestateSagaMetadata): Promise<this> {
  //   const ctxInstance = await ctx.get(sagaInstanceStateKey);
  //   if (!ctxInstance) return;
  //   const data = new Uint8Array(ctxInstance as readonly uint8[]);
  //   const instance = deserializeSagaInstance(data);
  //   Object.assign(this, instance);
  //   this.data = metadata.deserializeData(new Uint8Array(instance.data)) as Data;
  //   return this;
  // }

  save(ctx: RestateSagaContext, metadata: RestateSagaMetadata): void {
    ctx.set(
      sagaInstanceStateKey,
      Array.from(
        serializeSagaInstance(
          new SagaInstance(
            metadata.serializeData(this.data),
            this.currentState,
          ),
        ),
      ),
    );
  }
}

export const sagaInstanceType = typeOf<SagaInstance<readonly uint8[]>>();

export const sagaInstanceStateKey = '__instance';

export const serializeSagaInstance = getBSONSerializer(
  bsonBinarySerializer,
  sagaInstanceType,
);

export const deserializeSagaInstance = getBSONDeserializer<
  SagaInstance<readonly uint8[]>
>(bsonBinarySerializer, sagaInstanceType);
