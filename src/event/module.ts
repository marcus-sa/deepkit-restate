import { createModuleClass } from '@deepkit/app';

import { provideRestateObjectProxy } from '../utils.js';
import { EventServerApi } from './types.js';
import { RestateEventSubscriber } from './subscriber.js';
import { RestateEventPublisher } from './publisher.js';
import { RestateEventConfig } from './config.js';

export class RestateEventModule extends createModuleClass({
  config: RestateEventConfig,
  providers: [
    provideRestateObjectProxy<EventServerApi>(),
    RestateEventPublisher,
    RestateEventSubscriber,
  ],
  forRoot: true,
}) {}
