import { RestateClient } from '../restate-client.js';
import { EventServerApi, Subscriptions } from './types.js';
import { RestateEventConfig } from './config.js';

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
