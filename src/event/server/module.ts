import { createModuleClass } from '@deepkit/app';

import { RestateEventsServer } from './event-server.js';

export class RestateEventsServerModule extends createModuleClass({
  controllers: [RestateEventsServer],
}) {}
