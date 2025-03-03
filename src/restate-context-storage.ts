import { AsyncLocalStorage } from 'node:async_hooks';
import { uuid } from '@deepkit/type';

import {RestateMemoryClient} from "./restate-client.js";
import {
  RestateAwakeable,
  RestateCustomContext,
  RestateObjectContext,
  RestateRunAction,
  RestateSagaContext,
  RestateServiceContext, RestateStatus,
} from './types.js';

export class RestateContextStorage extends AsyncLocalStorage<
  RestateObjectContext | RestateSagaContext | RestateServiceContext
> {}

interface InMemoryAwakeable<T> {
  readonly resolve: (payload: T) => void;
  readonly reject: (error: Error) => void;
}

export class RestateMemoryContext implements RestateCustomContext {
  readonly #awakeables = new Map<string, InMemoryAwakeable<unknown>>();
  readonly #store = new Map<string, any>();

  constructor(private readonly client: RestateMemoryClient) {}

  async rpc<R>(...args: readonly any[]): Promise<R> {
    return await this.client.rpc(...args);
  }

  async send(...args: readonly any[]): Promise<RestateStatus> {
    return await this.client.send(...args);
  }

  async run(name: string, action: RestateRunAction<any>): Promise<void> {
    await action();
  }

  async get<T>(key: string): Promise<T> {
    return this.#store.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.#store.set(key, value);
  }

  resolveAwakeable<T>(id: string, payload: T): void {
    const awakeable = this.#awakeables.get(id);
    awakeable?.resolve(payload);
  }

  rejectAwakeable(id: string, reason: string): void {
    const awakeable = this.#awakeables.get(id);
    awakeable?.reject(new Error(reason));
  }

  awakeable<T>(): RestateAwakeable<T> {
    const id = uuid();

    const promise = new Promise((resolve, reject) => {
      this.#awakeables.set(id, { resolve, reject });
    });

    return {
      id,
      promise,
    } as RestateAwakeable<T>;
  }
}

export class RestateMemoryContextStorage {
  constructor(private readonly client: RestateMemoryClient) {}

  getStore(): RestateCustomContext {
    return new RestateMemoryContext(this.client);
  }
}
