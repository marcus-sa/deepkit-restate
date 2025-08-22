import { serializeBSON } from '@deepkit/bson';
import { resolveRuntimeType } from '@deepkit/type';
import { isClassInstance } from '@deepkit/core';

import { EventProcessorApi, PublishEvent, PublishOptions } from './types.js';
import { fastHash, getTypeHash, getTypeName } from '../utils.js';
import { RestateClient } from '../types.js';
import { RestatePubSubModule } from './module.js';

export class RestateEventPublisher {
  constructor(
    private readonly module: RestatePubSubModule,
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
      const version = this.module.config.eventVersioning
        ? getTypeHash(type)
        : undefined;
      return {
        name: getTypeName(type),
        id: fastHash(data),
        data: Array.from(data),
        version,
      };
    });

    const idempotencyKey = eventsToPublish.map(e => e.id).join('-');

    void this.client.send(
      this.processor.process(eventsToPublish, {
        stream: options?.stream || this.module.config.defaultStream,
        cluster: options?.cluster || this.module.config.cluster,
        sse: options?.sse,
      }),
      {
        delay: options?.delay,
        idempotencyKey,
      },
    );
  }
}
