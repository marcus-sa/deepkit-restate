import { SerializedType } from '@deepkit/type';

import { RestateObject } from '../types.js';
import { SubscriptionNotFound, SubscriptionTypeNoMatch } from './errors.js';

export interface Subscription {
  readonly service: string;
  readonly method: string;
  readonly type: SerializedType;
}

export type Subscriptions = readonly Subscription[];

export interface Event {
  readonly name: string;
  readonly processed: boolean;
  readonly success: boolean;
  readonly data: Uint8Array;
  readonly type: SerializedType;
}

export type Events = readonly Event[];

export interface PublishEvent {
  readonly data: Uint8Array;
  readonly name: string;
}

export interface PublishOptions {
  readonly delay?: number;
}

export interface EventServerHandlers {
  getSubscriptions(): Promise<Subscriptions>;
  // TODO: store all processed events
  // getEvents(): Promise<Events>;
  subscribe(subscriptions: Subscriptions): Promise<void>;
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
