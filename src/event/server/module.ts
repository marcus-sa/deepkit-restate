import { createModuleClass } from '@deepkit/app';
import { provide } from '@deepkit/injector';

import { RestateEventsServer } from './events-server.js';
import { EventsController } from './events.controller.js';
import { EventsSubject } from './types.js';
import { Subject } from 'rxjs';
import { PublishEvent } from '../types.js';

export class RestateEventsServerModule extends createModuleClass({
  controllers: [RestateEventsServer, EventsController],
  listeners: [EventsController],
  providers: [provide<EventsSubject>(() => new Subject<PublishEvent>())],
  forRoot: true,
}) {}
