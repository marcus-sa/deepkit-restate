import { ReceiveType, ReflectionKind, resolveReceiveType } from '@deepkit/type';
import { base64ToUint8Array } from '@deepkit/core';
import { EventSource } from 'eventsource';
import { deserializeBSON } from '@deepkit/bson';

import { SubscribeOptions } from './types.js';
import { RestatePubSubConfig } from './config.js';
import { getTypeHash, getTypeName } from '../utils.js';

export class RestateEventSubscriber {
  constructor(private readonly config: RestatePubSubConfig) {
    if (!this.config.sse) {
      throw new Error('SSE is not configured');
    }
  }

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
      types.map(type => [
        this.config.eventVersioning
          ? `${getTypeName(type)}:${getTypeHash(type)}`
          : getTypeName(type),
        type,
      ]),
    );
    const stream = options?.stream || this.config.defaultStream;
    const eventSource = new EventSource(
      `${this.config.sse!.url}/sse/${this.config.cluster}/${stream}/${events.keys().toArray().join(',')}`,
      {
        withCredentials: true,
      },
    );
    for (const [id, type] of events.entries()) {
      eventSource.addEventListener(id, event => {
        callback(
          deserializeBSON(
            base64ToUint8Array(event.data),
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
