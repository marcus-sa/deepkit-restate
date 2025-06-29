import { createModuleClass } from '@deepkit/app';
import { provide } from '@deepkit/injector';

import { RestateEventsServer } from './events-server.js';
import { EventsController } from './events.controller.js';
import { EventsSubject } from './types.js';
import { Subject } from 'rxjs';
import { PublishEvent } from '../types.js';
import { RestateEventsServerConfig } from './config.js';

export class RestateEventServerModule extends createModuleClass({
  config: RestateEventsServerConfig,
  controllers: [RestateEventsServer, EventsController],
  providers: [provide<EventsSubject>(() => new Subject<PublishEvent>())],
  forRoot: true,
}) {
  override process() {
    if (this.config.sse.autoDiscover) {
      this.addListener(EventsController);
    }
  }
}
