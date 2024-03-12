import { RestateSagaContext } from '../types';
import { Saga, SagaLifecycleHooks } from './saga';
import {
  SagaInstance,
  sagaInstanceStateKey,
  sagaInstanceType,
  serializeSagaInstance,
} from './saga-instance';
import { SagaActions } from './saga-actions';
import { Type } from '@deepkit/type';
import { RestateSagaMetadata } from '../decorator';

export class SagaManager<Data> {
  constructor(
    private readonly ctx: RestateSagaContext,
    private readonly saga: Saga<Data> & SagaLifecycleHooks<Data>,
    private readonly metadata: RestateSagaMetadata,
  ) {}

  private async processActions(
    instance: SagaInstance<Data>,
    actions: SagaActions<Data>,
  ): Promise<void> {
    while (true) {
      if (actions.localException) {
        actions = await this.saga.definition.handleReply(actions, true);
      } else {
        // only do this if successful
        sagaInstance.lastRequestId =
          await this.sagaCommandProducer.sendCommands(
            this.sagaType,
            sagaInstance.sagaId,
            actions.commands,
            this.sagaReplyChannel,
          );

        if (actions.updatedState) {
          instance.currentState = actions.updatedState;
        }
        if (actions.updatedData) {
          instance.data = actions.updatedData;
        }

        if (actions.endState) {
          await this.performEndStateActions(
            sagaInstance.sagaId,
            sagaInstance,
            actions.compensating,
            sagaData,
          );
        }

        instance.save(this.ctx, this.metadata);

        if (!actions.local) break;

        actions = await this.saga.definition.handleReply(actions, false);
      }
    }
  }

  async restoreInstance(data: Data): Promise<SagaInstance<Data>> {
    return ((await SagaInstance.restore<Data>(this.ctx, this.metadata)) ||
      new SagaInstance<Data>(data)) as SagaInstance<Data>;
  }

  async start(data: Data): Promise<SagaInstance<Data>> {
    const instance = await this.restoreInstance(data);
    // const instance = await new SagaInstance(data).restore(this.ctx, this.metadata);

    await this.ctx.sideEffect(async () =>
      this.saga.onStarting?.(instance.data),
    );

    const actions = await this.saga.definition.start(instance.data);

    if (actions.localException) {
      throw actions.localException;
    }

    await this.processActions(instance, actions);

    return instance;
  }
}
