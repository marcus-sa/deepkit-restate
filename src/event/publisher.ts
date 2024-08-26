import { getBSONSerializer } from '@deepkit/bson';
import {
  assertType,
  ReceiveType,
  ReflectionKind,
  resolveReceiveType,
  TypeTuple,
} from '@deepkit/type';

import { RestateContextStorage } from '../restate-context-storage.js';
import { RestateClient } from '../restate-client.js';
import { EventServerApi, PublishEvent, PublishOptions } from './types.js';
import { RestateEventConfig } from './config.js';
import { MissingTypeName } from './errors.js';

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
    type?: ReceiveType<E>,
  ): Promise<void> {
    type = resolveReceiveType(type);
    assertType(type, ReflectionKind.tuple);

    const eventsToPublish = events.map<PublishEvent>((event, i) => {
      const { type: eventType } = (type as TypeTuple).types[i];
      if (!eventType.typeName) {
        throw new MissingTypeName(eventType);
      }

      const serialize = getBSONSerializer(undefined, eventType);

      return {
        name: eventType.typeName,
        data: serialize(event),
      };
    });

    const ctx = this.contextStorage.getStore();
    if (ctx && 'send' in ctx) {
      await ctx.send(
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
