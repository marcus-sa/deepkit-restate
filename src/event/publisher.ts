import { serializeBSON } from '@deepkit/bson';
import { resolveRuntimeType } from '@deepkit/type';
import { isClassInstance } from '@deepkit/core';
import { InvocationHandle, TerminalError } from '@restatedev/restate-sdk';

import { EventProcessorApi, PublishEvent, PublishOptions } from './types.js';
import { fastHash, getTypeHash, getTypeName } from '../utils.js';
import { RestateClient } from '../types.js';
import { RestatePubSubModule } from './module.js';

export class RestateEventPublisher {
  constructor(
    private readonly client: RestateClient,
    private readonly processor: EventProcessorApi,
    private readonly module?: RestatePubSubModule,
  ) {}

  async publish<E extends any[]>(
    events: E,
    options?: PublishOptions,
  ): Promise<InvocationHandle> {
    const eventTypes = events.map(event =>
      resolveRuntimeType(event.constructor),
    );

    const eventsToPublish = events.map<PublishEvent>((event, i) => {
      if (!isClassInstance(event)) {
        throw new Error('Event must be a class instance');
      }
      const type = eventTypes[i];
      const data = serializeBSON(event, undefined, type);
      const version = this.module?.config.eventVersioning
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

    const stream = options?.stream || this.module?.config.defaultStream;
    if (!stream) {
      throw new TerminalError('No stream configured');
    }

    const cluster = options?.cluster || this.module?.config.cluster;
    if (!cluster) {
      throw new TerminalError('No cluster configured');
    }

    return this.client.send(
      this.processor.process(eventsToPublish, {
        stream,
        cluster,
        sse: options?.sse,
      }),
      {
        delay: options?.delay,
        idempotencyKey,
      },
    );
  }
}
