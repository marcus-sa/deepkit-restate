import { AsyncLocalStorage } from 'node:async_hooks';

import {
  RestateCustomContext,
  RestateObjectContext,
  RestateRunAction,
  RestateSagaContext,
  RestateServiceContext,
} from './types.js';

export class RestateContextStorage extends AsyncLocalStorage<
  RestateObjectContext | RestateSagaContext | RestateServiceContext
> {
}

export class NoopRestateContextStorage {
  getStore(): Pick<RestateCustomContext, 'run'> {
    return {
      run: async (action: RestateRunAction<any>) => action(),
    };
  }
}
