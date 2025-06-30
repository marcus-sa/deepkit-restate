import { restate } from '../../decorator.js';
import { RestateObjectContext } from '../../types.js';
import {
  EventHandler,
  EventHandlers,
  EventStoreApi,
  EventStoreHandlers,
} from '../types.js';

const HANDLERS_STATE_KEY = 'handlers';

@restate.object<EventStoreApi>()
export class RestateEventStore implements EventStoreHandlers {
  constructor(private readonly ctx: RestateObjectContext) {}

  async #getHandlers(): Promise<EventHandlers> {
    return (await this.ctx.get<EventHandlers>(HANDLERS_STATE_KEY)) || [];
  }

  @(restate.shared().handler())
  async getHandlers(): Promise<EventHandlers> {
    return await this.#getHandlers();
  }

  @restate.handler()
  async registerHandlers(newHandlers: EventHandlers): Promise<void> {
    const currentHandlers = await this.#getHandlers();
    const allHandlers = new Map<string, EventHandler>();

    const generateKey = (sub: EventHandler) =>
      `${sub.service}-${sub.method}-${sub.eventName}:${sub.eventVersion}`;

    currentHandlers.forEach(sub => {
      const key = generateKey(sub);
      allHandlers.set(key, sub);
    });

    newHandlers.forEach(sub => {
      const key = generateKey(sub);
      allHandlers.set(key, sub);
    });

    console.log(allHandlers.values().toArray());

    this.ctx.set<EventHandlers>(
      HANDLERS_STATE_KEY,
      allHandlers.values().toArray(),
    );
  }
}
