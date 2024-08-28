import { restate } from '../../decorator.js';
import { RestateObjectContext } from '../../types.js';
import { invokeOneWay } from '../../utils.js';
import {
  EventServerApi,
  EventServerHandlers,
  PublishEvent,
  PublishOptions,
  Subscription,
  Subscriptions,
} from '../types.js';

const SUBSCRIPTIONS_STATE_KEY = 'subscriptions';

@restate.object<EventServerApi>()
export class RestateEventsServer implements EventServerHandlers {
  constructor(private readonly ctx: RestateObjectContext) {}

  async #getSubscriptions(): Promise<Subscriptions> {
    return (await this.ctx.get<Subscriptions>(SUBSCRIPTIONS_STATE_KEY)) || [];
  }

  @(restate.shared().handler())
  async getSubscriptions(): Promise<Subscriptions> {
    return await this.#getSubscriptions();
  }

  @(restate.shared().handler())
  async publish(
    events: readonly PublishEvent[],
    options?: PublishOptions,
  ): Promise<void> {
    const allSubscriptions = await this.#getSubscriptions();

    await Promise.all(
      events.flatMap(({ data, name }) => {
        const eventSubscriptions = allSubscriptions.filter(
          ({ typeName }) => typeName === name,
        );

        return eventSubscriptions.map(subscription =>
          invokeOneWay(this.ctx, {
            service: subscription.service,
            method: subscription.method,
            data,
            ...options,
          }),
        );
      }),
    );
  }

  @restate.handler()
  async subscribe(newSubscriptions: Subscriptions): Promise<void> {
    const currentSubscriptions = await this.#getSubscriptions();
    const allSubscriptions = new Map<string, Subscription>();

    const generateKey = (sub: Subscription) => `${sub.service}-${sub.method}-${sub.typeName}`;

    currentSubscriptions.forEach(sub => {
      const key = generateKey(sub);
      allSubscriptions.set(key, sub);
    });

    newSubscriptions.forEach(sub => {
      const key = generateKey(sub);
      allSubscriptions.set(key, sub);
    });

    this.ctx.set(SUBSCRIPTIONS_STATE_KEY, [...allSubscriptions.values()]);
  }
}
