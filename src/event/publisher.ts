import { serializeBSON } from '@deepkit/bson';
import { ClassType } from '@deepkit/core';

import { RestateClient } from '../client.js';
import { RestateContextStorage } from '../context.js';
import { RestateEventConfig } from './config.js';
import { EventServerApi, PublishEvent, PublishOptions } from './types.js';

export class RestateEventsPublisher {
  constructor(
    private readonly config: RestateEventConfig,
    private readonly contextStorage: RestateContextStorage,
    private readonly client: RestateClient,
    private readonly server: EventServerApi,
  ) {}

  async publish<E extends any[]>(
    events: E,
    options?: PublishOptions,
  ): Promise<void> {
    const eventsToPublish = events.map<PublishEvent>(event => {
      const eventType = event.constructor as ClassType;
      return {
        name: eventType.name,
        data: serializeBSON(event, undefined, eventType),
      };
    });

    const ctx = this.contextStorage.getStore();
    if (ctx && 'send' in ctx) {
      ctx.send(
        this.config.cluster,
        this.server.publish(eventsToPublish, options),
      );
    } else {
      await this.client.send(
        this.config.cluster,
        this.server.publish(eventsToPublish, options),
      );
    }
  }
}
