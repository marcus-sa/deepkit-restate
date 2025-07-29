import { createModuleClass } from '@deepkit/app';

import { RestateEventStore } from './event-store.js';
import { ServerSentEventsController } from './sse.controller.js';
import { Clusters } from './types.js';
import { RestatePubSubServerConfig } from './config.js';
import {
  HttpMiddleware,
  httpMiddleware,
  HttpMiddlewareFn,
} from '@deepkit/http';
import { ClassType } from '@deepkit/core';
import { RestateEventProcessor } from './event-processor.js';

export class RestatePubSubServerModule extends createModuleClass({
  config: RestatePubSubServerConfig,
  controllers: [
    RestateEventStore,
    RestateEventProcessor,
    ServerSentEventsController,
  ],
  providers: [Clusters],
  forRoot: true,
}) {
  override process() {
    if (this.config.sse.autoDiscover) {
      this.addListener(ServerSentEventsController);
    }
  }

  configureMiddlewareForServerSentEvents(
    ...middleware: (HttpMiddlewareFn | ClassType<HttpMiddleware>)[]
  ): this {
    this.addMiddleware(
      httpMiddleware
        .for(...middleware)
        .forControllers(ServerSentEventsController),
    );
    return this;
  }
}
