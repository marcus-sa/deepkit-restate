import { ReceiveType, ReflectionKind, resolveReceiveType } from '@deepkit/type';
import { EventSource } from 'eventsource';
import { deserializeBSON } from '@deepkit/bson';

import { SubscribeOptions } from './types.js';
import { RestateEventConfig } from './config.js';
import { getTypeHash, getTypeName } from '../utils.js';

export class RestateEventSubscriber {
  constructor(private readonly config: RestateEventConfig) {}

  async subscribe<T>(
    callback: (event: T) => Promise<unknown> | unknown,
    options?: SubscribeOptions,
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
    const stream = options?.stream || this.config.defaultStream;
    const eventSource = new EventSource(
      `http://${this.config.host}:${this.config.port}/sse/${this.config.cluster}/${stream}/${events.keys().toArray().join(',')}`,
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
}
