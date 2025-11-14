import { RestatePromise, serde } from '@restatedev/restate-sdk';

import { restate } from '../../decorator.js';
import { RestateServiceContext } from '../../types.js';
import {
  PublishEvent,
  PublishOptions,
  EventProcessorHandlers,
  EventProcessorApi,
  EventStoreApi,
  ProcessArgs,
} from '../types.js';
import { RestatePubSubServerConfig, RestateSseConfig } from './config.js';

@restate.service<EventProcessorApi>()
export class RestateEventProcessor implements EventProcessorHandlers {
  constructor(
    private readonly ctx: RestateServiceContext,
    private readonly store: EventStoreApi,
    private readonly sseConfig: RestateSseConfig,
    private readonly config: RestatePubSubServerConfig,
  ) {}

  @restate.handler()
  async process({ events, options }: ProcessArgs): Promise<void> {
    const cluster = options?.cluster || this.config.cluster!;
    const allHandlers = await this.ctx.call(cluster, this.store.getHandlers());

    for (const event of events) {
      const eventHandlers = allHandlers.filter(
        handler => handler.eventName === event.name,
      );
      for (const handler of eventHandlers) {
        if (handler.handlerType === 'service') {
          // Service handlers: send regardless of key, but exclude key from call
          this.ctx.genericSend({
            service: handler.service,
            method: handler.method,
            parameter: event.data,
            headers: {
              'x-restate-event': event.name,
            },
            inputSerde: serde.json,
            idempotencyKey: event.id,
          });
        } else if (handler.handlerType === 'object' && options?.key) {
          // Object handlers: only send when key is present, include key in call
          this.ctx.genericSend({
            service: handler.service,
            method: handler.method,
            key: options.key,
            parameter: event.data,
            headers: {
              'x-restate-event': event.name,
            },
            inputSerde: serde.json,
            idempotencyKey: `${options.key}:${event.id}`,
          });
        }
        // Object handlers without key are skipped
      }
    }

    if (this.sseConfig.nodes && (options?.sse ?? this.sseConfig.all)) {
      await this.fanOutServerSentEvents(
        cluster,
        options?.stream || this.config.defaultStream!,
        this.sseConfig.nodes,
        events,
      );
    }
  }

  private async fanOutServerSentEvents(
    cluster: string,
    stream: string,
    nodes: string[],
    events: readonly PublishEvent[],
  ) {
    await RestatePromise.all(
      nodes.map(node =>
        this.ctx.run<void>(
          `fan-out server-sent events to node "${node}"`,
          async () => {
            // TODO: only publish to controllers that do have active subscriptions
            const response = await fetch(
              `http://${node}/sse/${cluster}/${stream}`,
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
}
