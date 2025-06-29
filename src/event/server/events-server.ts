import { RestatePromise, serde, TerminalError } from '@restatedev/restate-sdk';
import * as dns from 'node:dns/promises';

import { restate } from '../../decorator.js';
import { RestateObjectContext } from '../../types.js';
import {
  EventServerApi,
  EventServerHandlers,
  PublishEvent,
  PublishOptions,
  EventHandler,
  EventHandlers,
} from '../types.js';
import { RestateEventConfig } from '../config.js';
import { RestateEventsServerConfig } from './config.js';

const HANDLERS_STATE_KEY = 'handlers';

@restate.object<EventServerApi>()
export class RestateEventsServer implements EventServerHandlers {
  constructor(
    private readonly ctx: RestateObjectContext,
    private readonly config: RestateEventConfig,
    private readonly serverConfig: RestateEventsServerConfig,
  ) {}

  async #getHandlers(): Promise<EventHandlers> {
    return (await this.ctx.get<EventHandlers>(HANDLERS_STATE_KEY)) || [];
  }

  @(restate.shared().handler())
  async getHandlers(): Promise<EventHandlers> {
    return await this.#getHandlers();
  }

  @(restate.shared().handler())
  async publish(
    events: readonly PublishEvent[],
    options?: PublishOptions,
  ): Promise<void> {
    const allHandlers = await this.#getHandlers();

    for (const event of events) {
      const eventHandlers = allHandlers.filter(
        handler =>
          handler.eventName === event.name &&
          handler.eventVersion === event.version,
      );
      for (const handler of eventHandlers) {
        this.ctx.genericSend({
          service: handler.service,
          method: handler.method,
          parameter: new Uint8Array(event.data),
          inputSerde: serde.binary,
        });
      }
    }

    if (this.serverConfig.hosts && (options?.sse ?? this.serverConfig.sse)) {
      await this.fanOutServerSentEvents(this.serverConfig.hosts, events);
    }
  }

  private async fanOutServerSentEvents(
    hosts: string[],
    events: readonly PublishEvent[],
  ) {
    await RestatePromise.all(
      hosts.map(host =>
        this.ctx.run(
          `fan-out server-sent events to host "${host}"`,
          async () => {
            // TODO: only publish to controllers that do have active subscriptions
            const response = await fetch(
              `http://${host}:${this.config.port}/events/publish`,
              {
                method: 'POST',
                body: JSON.stringify(events),
                headers: {
                  'content-type': 'application/json',
                },
              },
            );
            if (!response.ok) {
              throw new Error(await response.text());
            }
          },
          {
            initialRetryIntervalMillis: 250,
            retryIntervalFactor: 2,
            maxRetryAttempts: 5,
          },
        ),
      ),
    );
  }

  @restate.handler()
  async registerHandlers(newHandlers: EventHandlers): Promise<void> {
    const currentHandlers = await this.#getHandlers();
    const allHandlers = new Map<string, EventHandler>();

    const generateKey = (sub: EventHandler) =>
      `${sub.service}-${sub.method}-${sub.eventName}:${sub.eventVersion}`;

    currentHandlers.forEach(sub => {
      const key = generateKey(sub);
      allHandlers.set(key, sub);
    });

    newHandlers.forEach(sub => {
      const key = generateKey(sub);
      allHandlers.set(key, sub);
    });

    this.ctx.set<EventHandlers>(
      HANDLERS_STATE_KEY,
      allHandlers.values().toArray(),
    );
  }
}
