import { RestatePromise, serde } from '@restatedev/restate-sdk';

import { restate } from '../../decorator.js';
import { RestateServiceContext } from '../../types.js';
import {
  PublishEvent,
  PublishOptions,
  EventProcessorHandlers,
  EventProcessorApi,
  EventStoreApi,
} from '../types.js';
import { RestatePubSubConfig } from '../config.js';
import { RestateSseConfig } from './config.js';

@restate.service<EventProcessorApi>()
export class RestateEventProcessor implements EventProcessorHandlers {
  constructor(
    private readonly ctx: RestateServiceContext,
    private readonly store: EventStoreApi,
    private readonly config: RestatePubSubConfig,
    private readonly sseConfig: RestateSseConfig,
  ) {}

  @restate.handler()
  async process(
    events: readonly PublishEvent[],
    options?: PublishOptions,
  ): Promise<void> {
    const cluster = options?.cluster || this.config.cluster!;
    const allHandlers = await this.ctx.call(cluster, this.store.getHandlers());

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
          // TODO: provide stream as second argument
          parameter: new Uint8Array(event.data),
          inputSerde: serde.binary,
          idempotencyKey: event.id,
        });
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
        this.ctx.run(
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
