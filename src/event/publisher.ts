import { serializeBSON } from '@deepkit/bson';
import {
  ReflectionKind,
  resolveRuntimeType,
  TypeClass,
  TypeTuple,
  TypeUnion,
} from '@deepkit/type';
import { isClassInstance } from '@deepkit/core';

import { RestateContextStorage } from '../restate-context-storage.js';
import { RestateClient } from '../restate-client.js';
import { EventServerApi, PublishEvent, PublishOptions } from './types.js';
import { RestateEventConfig } from './config.js';
import { getTypeHash, getTypeName } from '../utils.js';
import { BrokerBus } from '@deepkit/broker';
import { RestatePromise } from '@restatedev/restate-sdk';

export class RestateEventsPublisher {
  constructor(
    private readonly config: RestateEventConfig,
    private readonly contextStorage: RestateContextStorage,
    private readonly client: RestateClient,
    private readonly bus: BrokerBus,
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
        this.config.cluster,
        this.server.publish(eventsToPublish, options),
      );
      // await RestatePromise.all(
      //   eventsToPublish.map((event, i) => {
      //     return ctx.run(`publish ${event.name}`, async () => {
      //       await this.bus.adapter.publish(
      //         `restate-event:${event.name}:${event.version}`,
      //         events[i],
      //         eventTypes[i],
      //       );
      //     });
      //   }),
      // );
    } else {
      await this.client.send(
        this.config.cluster,
        this.server.publish(eventsToPublish, options),
      );
      // await Promise.all(
      //   eventsToPublish.map(async (event, i) => {
      //     await this.bus.adapter.publish(
      //       `restate-event:${event.name}:${event.version}`,
      //       events[i],
      //       eventTypes[i],
      //     );
      //   }),
      // );
    }
  }
}
