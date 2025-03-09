import { createModuleClass } from '@deepkit/app';

import { provideRestateObjectProxy } from '../utils/type.js';
import { RestateEventConfig } from './config.js';
import { RestateEventsPublisher } from './publisher.js';
import { RestateEventsSubscriber } from './subscriber.js';
import { EventServerApi } from './types.js';

export class RestateEventModule extends createModuleClass({
  config: RestateEventConfig,
  providers: [
    provideRestateObjectProxy<EventServerApi>(),
    RestateEventsPublisher,
    RestateEventsSubscriber,
  ],
  forRoot: true,
}) {}
