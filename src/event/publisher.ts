import { serializeBSON } from '@deepkit/bson';
import { resolveRuntimeType } from '@deepkit/type';
import { isClassInstance } from '@deepkit/core';

import { EventProcessorApi, PublishEvent, PublishOptions } from './types.js';
import { RestatePubSubConfig } from './config.js';
import { fastHash, getTypeHash, getTypeName } from '../utils.js';
import { RestateClient } from '../types.js';

export class RestateEventPublisher {
  constructor(
    private readonly config: RestatePubSubConfig,
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

    const idempotencyKey = eventsToPublish.map(e => e.id).join('-');

    await this.client.send(
      this.processor.process(eventsToPublish, {
        stream: options?.stream || this.config.defaultStream,
        cluster: options?.cluster || this.config.cluster,
        sse: options?.sse,
      }),
      {
        delay: options?.delay,
        idempotencyKey,
      },
    );
  }
}
