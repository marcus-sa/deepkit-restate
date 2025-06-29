import { RestateObject } from '../types.js';
import { SubscriptionNotFound, SubscriptionTypeNoMatch } from './errors.js';

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
  readonly sse?: boolean;
}

export interface EventServerHandlers {
  getHandlers(): Promise<EventHandlers>;
  // TODO: store all processed events
  // getEvents(): Promise<Events>;
  registerHandlers(subscriptions: EventHandlers): Promise<void>;
  publish(
    events: readonly PublishEvent[],
    options?: PublishOptions,
  ): Promise<void>;
}

export type EventServerApi = RestateObject<
  'Event',
  EventServerHandlers,
  [SubscriptionNotFound, SubscriptionTypeNoMatch]
>;
