import { createModule } from '@deepkit/app';

import { RestateEventsServer } from './event-server.js';

export class RestateEventsServerModule extends createModule({
  controllers: [RestateEventsServer],
}) {}
