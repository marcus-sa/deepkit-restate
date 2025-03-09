import { RestateClient } from '../client.js';
import { RestateEventConfig } from './config.js';
import { EventServerApi, Subscriptions } from './types.js';

export class RestateEventsSubscriber {
  constructor(
    private readonly config: RestateEventConfig,
    private readonly client: RestateClient,
    private readonly server: EventServerApi,
  ) {}

  async subscribe(subscriptions: Subscriptions): Promise<void> {
    await this.client.send(
      this.config.cluster,
      this.server.subscribe(subscriptions),
    );
  }
}
