import { restate } from '../../decorator.js';
import { RestateObjectContext } from '../../types.js';
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

    for (const { data, name } of events) {
      const eventSubscriptions = allSubscriptions.filter(
        ({ typeName }) => typeName === name,
      );

      for (const subscription of eventSubscriptions) {
        this.ctx.genericSend({
          service: subscription.service,
          method: subscription.method,
          parameter: data,
          delay: options?.delay,
          ...options,
        });
      }
    }
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
