import { createModuleClass } from '@deepkit/app';
import { provide } from '@deepkit/injector';

import { RestateEventStore } from './event-store.js';
import { ServerSentEventsController } from './sse.controller.js';
import { Clusters, Streams } from './types.js';
import { RestateEventsServerConfig } from './config.js';
import {
  HttpMiddleware,
  httpMiddleware,
  HttpMiddlewareFn,
} from '@deepkit/http';
import { ClassType } from '@deepkit/core';
import { RestateEventProcessor } from './event-processor.js';
import { RestateEventsServer } from './event-server.js';

export class RestateEventServerModule extends createModuleClass({
  config: RestateEventsServerConfig,
  controllers: [
    RestateEventStore,
    RestateEventProcessor,
    ServerSentEventsController,
    RestateEventsServer,
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
