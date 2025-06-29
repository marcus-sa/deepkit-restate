import { AsyncLocalStorage } from 'node:async_hooks';
import { uuid } from '@deepkit/type';

import {
  RestateAwakeable,
  RestateCustomContext,
  RestateObjectContext,
  RestateRunAction,
  RestateSagaContext,
  RestateServiceContext,
} from './types.js';
import { RestatePromise } from '@restatedev/restate-sdk';

export class RestateContextStorage extends AsyncLocalStorage<
  RestateObjectContext | RestateSagaContext | RestateServiceContext
> {}

interface InMemoryAwakeable<T> {
  readonly resolve: (payload: T) => void;
  readonly reject: (error: Error) => void;
}

export class RestateInMemoryContext
  implements Omit<RestateCustomContext, 'call' | 'send'>
{
  readonly #awakeables = new Map<string, InMemoryAwakeable<unknown>>();
  readonly #store = new Map<string, any>();

  run(name: string, action: RestateRunAction<any>): RestatePromise<void> {
    return action();
  }

  async get<T>(key: string): Promise<T> {
    return this.#store.get(key);
  }

  set(key: string, value: unknown): void {
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

export class RestateInMemoryContextStorage {
  getStore(): Omit<RestateCustomContext, 'call' | 'send'> {
    return new RestateInMemoryContext();
  }
}
