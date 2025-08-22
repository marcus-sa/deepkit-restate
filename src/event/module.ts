import { createModuleClass } from '@deepkit/app';

import {
  provideRestateObjectProxy,
  provideRestateServiceProxy,
} from '../utils.js';
import { EventProcessorApi, EventStoreApi } from './types.js';
import { RestateEventSubscriber } from './subscriber.js';
import { RestateEventPublisher } from './publisher.js';
import { RestatePubSubConfig } from './config.js';
import { SCOPE } from '../types.js';

export class RestatePubSubModule extends createModuleClass({
  config: RestatePubSubConfig,
  providers: [
    provideRestateServiceProxy<EventProcessorApi>(),
    provideRestateObjectProxy<EventStoreApi>(),
  ],
  forRoot: true,
}) {
  override process() {
    this.addProvider(RestateEventPublisher);
    this.addProvider({
      provide: RestateEventPublisher,
      scope: SCOPE,
    });

    this.addProvider(RestateEventSubscriber);
    this.addProvider({
      provide: RestateEventSubscriber,
      scope: SCOPE,
    });
  }
}
