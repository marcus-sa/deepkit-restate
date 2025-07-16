import { serializeBSON } from '@deepkit/bson';
import { resolveRuntimeType } from '@deepkit/type';
import { isClassInstance } from '@deepkit/core';

import { RestateContextStorage } from '../context-storage.js';
import { RestateClient } from '../restate-client.js';
import { EventProcessorApi, PublishEvent, PublishOptions } from './types.js';
import { RestateEventConfig } from './config.js';
import { fastHash, getTypeHash, getTypeName } from '../utils.js';

export class RestateEventPublisher {
  constructor(
    private readonly config: RestateEventConfig,
    private readonly contextStorage: RestateContextStorage,
    private readonly client: RestateClient,
    private readonly processor: EventProcessorApi,
  ) {}

  async publish<E extends any[]>(
    events: E,
    options?: PublishOptions,
  ): Promise<void> {
    const eventTypes = events.map(event =>
      resolveRuntimeType(event.constructor),
    );

    const eventsToPublish = events.map<PublishEvent>((event, i) => {
      if (!isClassInstance(event)) {
        throw new Error('Event must be a class instance');
      }
      const type = eventTypes[i];
      const data = serializeBSON(event, undefined, type);
      return {
        name: getTypeName(type),
        version: getTypeHash(type),
        id: fastHash(data),
        data: Array.from(data),
      };
    });

    const ctx = this.contextStorage.getStore();
    const idempotencyKey = eventsToPublish.map(e => e.id).join('-');
    if (ctx && 'send' in ctx) {
      ctx.send(
        this.processor.process(eventsToPublish, {
          stream: options?.stream || this.config.defaultStream,
          cluster: this.config.cluster,
          sse: options?.sse,
        }),
        {
          delay: options?.delay,
          idempotencyKey,
        },
      );
    } else {
      await this.client.send(
        this.processor.process(eventsToPublish, {
          stream: options?.stream || this.config.defaultStream,
          cluster: this.config.cluster,
          sse: options?.sse,
        }),
        {
          delay: options?.delay,
          idempotencyKey,
        },
      );
    }
  }
}
