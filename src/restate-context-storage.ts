import { AsyncLocalStorage } from 'node:async_hooks';

import { RestateObjectContext, RestateSagaContext, RestateServiceContext } from './types.js';

export class RestateContextStorage extends AsyncLocalStorage<
  RestateObjectContext | RestateSagaContext | RestateServiceContext
> {
}
