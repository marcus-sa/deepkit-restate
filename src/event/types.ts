import { RestateObject, RestateService } from '../types.js';

export interface EventHandler {
  readonly service: string;
  readonly method: string;
  readonly eventName: string;
  readonly eventVersion: string;
}

export type EventHandlers = readonly EventHandler[];

export interface PublishEvent {
  readonly data: number[];
  readonly name: string;
  readonly version: string;
}

export interface PublishOptions {
  readonly delay?: number;
  // defaults to `default`
  readonly cluster?: string;
  // defaults to `all`
  readonly stream?: string;
  readonly sse?: boolean;
}

export interface SubscribeOptions {
  // defaults to `all`
  readonly stream?: string;
}

export interface EventStoreHandlers {
  getHandlers(): Promise<EventHandlers>;
  registerHandlers(handlers: EventHandlers): Promise<void>;
}

export type EventStoreApi = RestateObject<'event-store', EventStoreHandlers>;

export interface EventProcessorHandlers {
  process(
    events: readonly PublishEvent[],
    options?: PublishOptions,
  ): Promise<void>;
}

export type EventProcessorApi = RestateService<
  'event-processor',
  EventProcessorHandlers
>;

export interface EventServerHandlers {
  getHandlers(): Promise<EventHandlers>;
  registerHandlers(subscriptions: EventHandlers): Promise<void>;
  publish(
    events: readonly PublishEvent[],
    options?: PublishOptions,
  ): Promise<void>;
}

export type EventServerApi = RestateObject<'event-server', EventServerHandlers>;
