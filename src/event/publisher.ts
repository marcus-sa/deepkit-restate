import { serializeBSON } from '@deepkit/bson';
import { resolveRuntimeType } from '@deepkit/type';
import { isClassInstance } from '@deepkit/core';

import { RestateContextStorage } from '../restate-context-storage.js';
import { RestateClient } from '../restate-client.js';
import {
  EventProcessorApi,
  EventServerApi,
  PublishEvent,
  PublishOptions,
} from './types.js';
import { RestateEventConfig } from './config.js';
import { getTypeHash, getTypeName } from '../utils.js';

export class RestateEventPublisher {
  constructor(
    private readonly config: RestateEventConfig,
    private readonly contextStorage: RestateContextStorage,
    private readonly client: RestateClient,
    private readonly processor: EventProcessorApi,
    private readonly server: EventServerApi,
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
      return {
        name: getTypeName(type),
        version: getTypeHash(type),
        data: Array.from(serializeBSON(event, undefined, type)),
      };
    });

    const ctx = this.contextStorage.getStore();
    if (ctx && 'send' in ctx) {
      ctx.send(
        this.processor.process(eventsToPublish, {
          stream: options?.stream || this.config.defaultStream,
          cluster: this.config.cluster,
          sse: options?.sse,
        }),
        { delay: options?.delay },
      );
      // ctx.send(
      //   this.config.cluster,
      //   this.server.publish(eventsToPublish, {
      //     stream: options?.stream || this.config.defaultStream,
      //     cluster: this.config.cluster,
      //     sse: options?.sse,
      //   }),
      //   { delay: options?.delay },
      // );
    } else {
      await this.client.send(
        this.processor.process(eventsToPublish, {
          stream: options?.stream || this.config.defaultStream,
          cluster: this.config.cluster,
          sse: options?.sse,
        }),
        { delay: options?.delay },
      );
      // await this.client.send(
      //   this.config.cluster,
      //   this.server.publish(eventsToPublish, {
      //     stream: options?.stream || this.config.defaultStream,
      //     cluster: this.config.cluster,
      //     sse: options?.sse,
      //   }),
      //   { delay: options?.delay },
      // );
    }
  }
}
