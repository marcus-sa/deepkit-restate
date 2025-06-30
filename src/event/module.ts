import { createModuleClass } from '@deepkit/app';

import {
  provideRestateObjectProxy,
  provideRestateServiceProxy,
} from '../utils.js';
import { EventProcessorApi, EventServerApi, EventStoreApi } from './types.js';
import { RestateEventSubscriber } from './subscriber.js';
import { RestateEventPublisher } from './publisher.js';
import { RestateEventConfig } from './config.js';

export class RestateEventModule extends createModuleClass({
  config: RestateEventConfig,
  providers: [
    provideRestateServiceProxy<EventProcessorApi>(),
    provideRestateObjectProxy<EventStoreApi>(),
    provideRestateObjectProxy<EventServerApi>(),
    RestateEventPublisher,
    RestateEventSubscriber,
  ],
  forRoot: true,
}) {}
