import { http, HttpBody, HttpRequest, HttpResponse } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrapDone } from '@deepkit/framework';
import * as dns from 'node:dns/promises';

import { PublishEvent } from '../types.js';
import { Clusters, Streams } from './types.js';
import { fastHash } from '../../utils.js';
import { RestateSseConfig } from './config.js';
import { RestateEventConfig } from '../config.js';

@http.controller('sse/:cluster/:stream')
export class ServerSentEventsController {
  constructor(
    private readonly clusters: Clusters,
    private readonly sseConfig: RestateSseConfig,
    private readonly eventConfig: RestateEventConfig,
    private readonly logger: ScopedLogger,
  ) {}

  @eventDispatcher.listen(onServerMainBootstrapDone)
  async autoDiscoverServers() {
    if (!this.sseConfig.hosts && !this.eventConfig.host) {
      throw new Error('Hosts are not configured');
    }
    const hosts = this.sseConfig.hosts
      ? (
          await Promise.all(
            this.sseConfig.hosts.map(host => dns.resolve4(host)),
          )
        ).flat()
      : await dns.resolve4(this.eventConfig.host!);
    Object.assign(this.sseConfig, { hosts });
  }

  // TODO: publish should be internal only
  @http.POST('')
  async publish(
    cluster: string,
    stream: string,
    events: HttpBody<PublishEvent[]>,
  ) {
    for (const event of events) {
      this.clusters.get(cluster).get(stream).next(event);
    }
  }

  @http.GET(':events')
  subscribe(
    cluster: string,
    stream: string,
    events: string | string[],
    request: HttpRequest,
    response: HttpResponse,
  ) {
    events = (events as string).split(',') as string[];
    this.logger.log('subscribe', events);

    // TODO: replay from last event id upon reconnection
    // const lastEventId = request.headers['last-event-id'];

    request.socket.setKeepAlive(true);

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.flushHeaders();

    for (const id of events) {
      const subscription = this.clusters
        .get(cluster)
        .get(stream)
        .subscribe(event => {
          if (`${event.name}:${event.version}` === id) {
            this.logger.log('publish', event);
            response.write(`event: ${id}\n`);
            const data = new Uint8Array(event.data);
            response.write(`id: ${fastHash(data)}\n`);
            response.write(`data: ${Buffer.from(data).toString('base64')}\n\n`);
          }
        });

      request.on('close', () => {
        subscription.unsubscribe();
        response.end();
      });
    }
  }
}
