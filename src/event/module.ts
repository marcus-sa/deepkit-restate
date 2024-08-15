import { createModule } from '@deepkit/app';

import { provideRestateObjectProxy } from '../utils.js';
import { EventServerApi } from './types.js';
import { RestateEventsSubscriber } from './subscriber.js';
import { RestateEventsPublisher } from './publisher.js';
import { RestateEventConfig } from './config.js';

export class RestateEventModule extends createModule({
  config: RestateEventConfig,
  providers: [
    provideRestateObjectProxy<EventServerApi>(),
    RestateEventsPublisher,
    RestateEventsSubscriber,
  ],
  forRoot: true,
}) {}
