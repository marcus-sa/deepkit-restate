import { CombineablePromise } from '@restatedev/restate-sdk';

import { restate } from '../../decorator.js';
import { RestateObjectContext } from '../../types.js';
import { invokeOneWay } from '../../utils.js';
import { SubscriptionNotFound } from '../errors.js';
import {
  EventServerApi,
  EventServerHandlers,
  PublishEvent,
  PublishOptions,
  Subscriptions,
} from '../types.js';

const SUBSCRIPTIONS_STATE_KEY = 'subscriptions';

@restate.object<EventServerApi>()
export class RestateEventServer implements EventServerHandlers {
  constructor(private readonly ctx: RestateObjectContext) {}

  async #getSubscriptions(): Promise<Subscriptions> {
    return (await this.ctx.get<Subscriptions>(SUBSCRIPTIONS_STATE_KEY)) || [];
  }

  @(restate.shared().handler())
  async getSubscriptions(): Promise<Subscriptions> {
    return await this.#getSubscriptions();
  }

  @restate.handler()
  async publish(
    events: readonly PublishEvent[],
    options?: PublishOptions,
  ): Promise<void> {
    const subscriptions = await this.#getSubscriptions();
    await CombineablePromise.all(
      events.map(({ data, name }) => {
        const subscription = subscriptions.find(
          ({ type }) => type.typeName === name,
        );
        if (!subscription) {
          throw new SubscriptionNotFound();
        }

        return invokeOneWay((this.ctx as any).original, {
          service: subscription.service,
          method: subscription.method,
          data,
          ...options,
          // key,
        });
      }),
    );
  }

  @restate.handler()
  async subscribe(newSubscriptions: Subscriptions): Promise<void> {
    const currentSubscriptions = await this.#getSubscriptions();

    const allSubscriptions = currentSubscriptions.filter(currentSub =>
      newSubscriptions.some(
        newSub =>
          newSub.service === currentSub.service &&
          newSub.method === currentSub.method,
      ),
    );

    await this.ctx.set(SUBSCRIPTIONS_STATE_KEY, allSubscriptions);
  }
}
