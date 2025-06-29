import { http, HttpBody, HttpRequest, HttpResponse } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { PublishEvent } from '../types.js';
import { EventsSubject } from './types.js';
import { fastHash } from '../../utils.js';

@http.controller('events')
export class EventsController {
  constructor(
    private readonly subject: EventsSubject,
    private readonly logger: ScopedLogger,
  ) {}

  @http.POST('publish')
  async publish(events: HttpBody<PublishEvent[]>) {
    for (const event of events) {
      this.subject.next(event);
    }
  }

  @http.GET('subscribe/:events')
  subscribe(
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
      const subscription = this.subject.subscribe(event => {
        if (`${event.name}:${event.version}` === id) {
          this.logger.log('publish', event);
          response.write(`event: ${id}\n`);
          const data = new Uint8Array(event.data);
          response.write(`id: ${fastHash(data)}\n`);
          response.write(`data: ${Buffer.from(data).toString('utf8')}\n\n`);
        }
      });

      request.on('close', () => {
        subscription.unsubscribe();
        response.end();
      });
    }
  }
}
