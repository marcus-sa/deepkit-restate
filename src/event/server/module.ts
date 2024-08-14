import { createModule } from '@deepkit/app';

import { RestateEventServer } from './event-server.js';

export class RestateEventServerModule extends createModule({
  controllers: [RestateEventServer],
}) {}
