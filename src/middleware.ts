import { RestateSharedContext } from './types.js';
import { RestateClassMetadata, RestateHandlerMetadata } from './decorator.js';

export interface RestateMiddleware {
  execute(
    ctx: RestateSharedContext,
    classMetadata: RestateClassMetadata,
    handlerMetadata?: RestateHandlerMetadata,
  ): Promise<void> | void;
}
