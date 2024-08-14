import { ReceiveType, resolveReceiveType, serializeType } from '@deepkit/type';

import { RestateContextStorage } from '../restate-context-storage.js';
import { RestateClient } from '../restate-client.js';
import { EventServerApi, Subscription, Subscriptions } from './types.js';
import { RestateEventConfig } from './config.js';

export class RestateEventSubscriber {
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
