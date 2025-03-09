import { AsyncLocalStorage } from 'node:async_hooks';
import { ReceiveType, typeOf, uuid } from '@deepkit/type';
import {
  CombineablePromise,
  type ObjectContext,
  Rand,
  Context as RestateContext,
  TerminalError,
  WorkflowContext,
} from '@restatedev/restate-sdk';

import { RestateMemoryClient } from './client.js';
import { RestateConfig } from './config.js';
import {
  RestateObjectHandlerRequest,
  RestateRunAction,
  RestateSendOptions,
  RestateServiceHandlerRequest,
  RestateStatus,
} from './types.js';
import { retry } from './utils/retry.js';

export interface Request {
  readonly id: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly attemptHeaders: ReadonlyMap<string, string | string[] | undefined>;
  readonly body: Uint8Array;
  readonly extraArgs: unknown[];
}

export interface ContextDate {
  now(): Promise<number>;
  toJSON(): Promise<string>;
}

export interface RestateAwakeable<T> {
  readonly id: string;
  readonly promise: CombineablePromise<T>;
}

export interface Context extends ContextWithoutClients<RestateContext> {
  awakeable<T>(type?: ReceiveType<T>): RestateAwakeable<T>;
  resolveAwakeable<T>(
    id: string,
    payload: NoInfer<T>,
    type?: ReceiveType<T>,
  ): void;
  rejectAwakeable(id: string, reason: string): void;
  // only returns value if type argument was provided
  run(name: string, action: RestateRunAction<unknown>): Promise<void>;
  run<T>(
    name: string,
    action: RestateRunAction<T>,
    type?: ReceiveType<T>,
  ): Promise<T>;
  // used for objects
  send(
    key: string,
    request: RestateObjectHandlerRequest,
    options?: RestateSendOptions,
  ): void; // Promise<RestateStatus>
  // used for services
  send(
    request: RestateServiceHandlerRequest,
    options?: RestateSendOptions,
  ): void; // Promise<RestateStatus>
  // used for objects
  rpc<R, A extends any[]>(
    key: string,
    request: RestateObjectHandlerRequest<R, A>,
  ): Promise<R>;
  // used for services
  rpc<R, A extends any[]>(call: RestateServiceHandlerRequest<R, A>): Promise<R>;
}

export type ContextWithoutClients<T> = Omit<
  T,
  | 'workflowClient'
  | 'workflowSendClient'
  | 'serviceClient'
  | 'serviceSendClient'
  | 'objectClient'
  | 'objectSendClient'
  | 'run'
  | 'get'
  | 'set'
  | 'resolveAwakeable'
  | 'awakeable'
>;

export interface RestateServiceContext extends Context {}

export interface RestateObjectContext
  extends Context,
    ContextWithoutClients<ObjectContext> {
  get<T>(name: string, type?: ReceiveType<T>): Promise<T | null>;

  set<T>(name: string, value: T, type?: ReceiveType<T>): Promise<void>;
}

export interface RestateSagaContext
  extends Omit<RestateObjectContext, 'rpc' | 'send'>,
    ContextWithoutClients<WorkflowContext> {}

export const restateServiceContextType = typeOf<RestateServiceContext>();
export const restateObjectContextType = typeOf<RestateObjectContext>();
export const restateSagaContextType = typeOf<RestateSagaContext>();

export class RestateContextStorage extends AsyncLocalStorage<
  RestateObjectContext | RestateSagaContext | RestateServiceContext
> {}

interface InMemoryAwakeable<T> {
  readonly resolve: (payload: T) => void;
  readonly reject: (error: Error) => void;
}

export class RestateMemoryContext implements Context {
  readonly console = console;

  readonly date: ContextDate = {
    now: async () => Date.now(),
    toJSON: async () => new Date().toJSON(),
  };

  readonly rand: Rand = {
    random: () => Math.random(),
    uuidv4: () => uuid(),
  };

  constructor(
    private readonly client: RestateMemoryClient,
    private readonly config: RestateConfig,
    private readonly awakeables: Map<string, InMemoryAwakeable<unknown>>,
  ) {}

  request(): Request {
    throw new Error('Not implemented yet');
  }

  sleep(millis: number): CombineablePromise<void> {
    throw new Error('Not implemented yet');
  }

  async rpc<R>(...args: readonly any[]): Promise<R> {
    return await this.client.call(...args);
  }

  async send(...args: readonly any[]): Promise<RestateStatus> {
    return await this.client.send(...args);
  }

  async run(name: string, action: RestateRunAction<any>): Promise<void> {
    await retry(action, this.config.retry);
  }

  resolveAwakeable<T>(id: string, payload: T): void {
    const awakeable = this.awakeables.get(id);
    awakeable?.resolve(payload);
  }

  rejectAwakeable(id: string, reason: string): void {
    const awakeable = this.awakeables.get(id);
    awakeable?.reject(new Error(reason));
  }

  awakeable<T>(): RestateAwakeable<T> {
    const id = uuid();

    const promise = new Promise((resolve, reject) => {
      this.awakeables.set(id, { resolve, reject });
    });

    return {
      id,
      promise,
    } as RestateAwakeable<T>;
  }

  genericSend(): Promise<void> {
    throw new Error('Not implemented yet');
  }

  genericCall<REQ = Uint8Array, RES = Uint8Array>(): Promise<RES> {
    throw new Error('Not implemented yet');
  }
}

export class RestateObjectMemoryContext
  extends RestateMemoryContext
  implements RestateObjectContext
{
  constructor(
    client: RestateMemoryClient,
    config: RestateConfig,
    awakeables: Map<string, InMemoryAwakeable<unknown>>,
    private readonly store: RestateMemoryContextObjectStore,
  ) {
    super(client, config, awakeables);
  }

  get key() {
    return this.store.getKey();
  }

  async stateKeys(): Promise<string[]> {
    return this.store.stateKeys();
  }

  clear<TKey extends '_'>(name: string): void {
    this.store.clear(name);
  }

  clearAll(): void {
    this.store.clearAll();
  }

  async get<T>(key: string): Promise<T | null> {
    return this.store.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

export class RestateServiceMemoryContext
  extends RestateMemoryContext
  implements RestateServiceContext {}

export class RestateMemoryContextObjectStore {
  constructor(
    private readonly keyStorage: AsyncLocalStorage<string>,
    private readonly store: Map<string, Map<string, any>>,
  ) {}

  private getStore(): Map<string, any> {
    const key = this.getKey();
    let store = this.store.get(key);
    if (!store) {
      store = new Map();
      this.store.set(key, store);
    }
    return store;
  }

  clear(name: string): void {
    const store = this.getStore();
    store.delete(name);
  }

  clearAll(): void {
    const store = this.getStore();
    store.clear();
  }

  getKey() {
    const key = this.keyStorage.getStore();
    if (!key) {
      throw new TerminalError('No key found');
    }
    return key;
  }

  stateKeys(): string[] {
    const store = this.getStore();
    return Array.from(store.keys());
  }

  get<T>(name: string): T | null {
    const store = this.getStore();
    return store.get(name);
  }

  set<T>(name: string, value: T): void {
    const store = this.getStore();
    store.set(name, value);
  }
}

export class RestateMemoryContextObjectKeyValueStorage {
  readonly #keyValueStore = new Map<string, Map<string, Map<string, any>>>();

  constructor(private readonly keyStorage: AsyncLocalStorage<string>) {}

  get(name: string) {
    let store = this.#keyValueStore.get(name);
    if (!store) {
      store = new Map();
      this.#keyValueStore.set(name, store);
    }
    return new RestateMemoryContextObjectStore(this.keyStorage, store);
  }
}

export class RestateMemoryContextProvider {
  readonly objectKeyStorage = new AsyncLocalStorage<string>();
  readonly #awakeables = new Map<string, InMemoryAwakeable<unknown>>();
  readonly objectStorage = new RestateMemoryContextObjectKeyValueStorage(
    this.objectKeyStorage,
  );

  constructor(
    private readonly client: RestateMemoryClient,
    private readonly config: RestateConfig,
  ) {}

  getService(): RestateServiceMemoryContext {
    return new RestateServiceMemoryContext(
      this.client,
      this.config,
      this.#awakeables,
    );
  }

  getObject(name: string): RestateObjectMemoryContext {
    const store = this.objectStorage.get(name);
    return new RestateObjectMemoryContext(
      this.client,
      this.config,
      this.#awakeables,
      store,
    );
  }
}
