import {
  assertType,
  ReceiveType,
  ReflectionKind,
  resolveReceiveType,
  TypeUnion,
} from '@deepkit/type';
import { EventSource } from 'eventsource';
import { RestateClient } from '../restate-client.js';
import { EventHandlers, EventServerApi } from './types.js';
import { RestateEventConfig } from './config.js';
import { getTypeHash, getTypeName } from '../utils.js';
import { BrokerBus } from '@deepkit/broker';
import { Observable } from 'rxjs';
import { deserializeBSON } from '@deepkit/bson';

export class RestateEventsSubscriber {
  constructor(
    private readonly config: RestateEventConfig,
    private readonly client: RestateClient,
    private readonly bus: BrokerBus,
    private readonly server: EventServerApi,
  ) {}

  // TODO: use deepkit broker when it supports high-availability (multiple servers)
  // async subscribe<T>(
  //   callback: (event: T) => void,
  //   type?: ReceiveType<T>,
  // ): Promise<() => Promise<void>> {
  //   type = resolveReceiveType(type);
  //   if (type.kind === ReflectionKind.union) {
  //     for (const item of type.types) {
  //       if (item.kind !== ReflectionKind.class) {
  //         throw new Error('Only classes are supported');
  //       }
  //     }
  //   }
  //   const types = type.kind === ReflectionKind.union ? type.types : [type];
  //   const releases = await Promise.all(
  //     types.map(async type => {
  //       return await this.bus.adapter.subscribe(
  //         `restate-event:${getTypeName(type)}:${getTypeHash(type)}`,
  //         callback,
  //         type,
  //       );
  //     }),
  //   );
  //
  //   return async () => {
  //     await Promise.all(releases.map(release => release()));
  //   };
  // }

  async subscribe<T>(
    callback: (event: T) => Promise<unknown> | unknown,
    type?: ReceiveType<T>,
  ): Promise<() => Promise<void>> {
    type = resolveReceiveType(type);
    const types = type.kind === ReflectionKind.union ? type.types : [type];
    for (const type of types) {
      if (type.kind !== ReflectionKind.class) {
        throw new Error('Only classes are supported');
      }
    }
    const events = new Map(
      types.map(type => [`${getTypeName(type)}:${getTypeHash(type)}`, type]),
    );
    const eventSource = new EventSource(
      `http://${this.config.host}:${this.config.port}/events/subscribe/${events.keys().toArray().join(',')}`,
    );
    for (const [id, type] of events.entries()) {
      eventSource.addEventListener(id, event => {
        callback(
          deserializeBSON(
            new Uint8Array(Buffer.from(event.data, 'base64')),
            undefined,
            undefined,
            type,
          ),
        );
      });
    }

    return async () => eventSource.close();
  }

  /** @internal */
  async registerHandlers(handlers: EventHandlers): Promise<void> {
    await this.client.send(
      this.config.cluster,
      this.server.registerHandlers(handlers),
    );
  }
}
