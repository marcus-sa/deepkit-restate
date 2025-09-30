import { RestateSharedContext } from './types.js';
import { RestateClassMetadata, RestateHandlerMetadata } from './decorator.js';
import { ClassType, isClass } from '@deepkit/core';

export interface RestateMiddleware {
  execute: RestateMiddlewareFn;
}

export type RestateMiddlewareFn = (
  ctx: RestateSharedContext,
  classMetadata: RestateClassMetadata,
  handlerMetadata?: RestateHandlerMetadata,
) => Promise<void> | void;

export type RestateMiddlewareType =
  | ClassType<RestateMiddleware>
  | RestateMiddlewareFn;

export function isRestateMiddlewareClass(
  value: RestateMiddlewareType,
): value is ClassType<RestateMiddleware> {
  return isClass(value);
}

export function isRestateMiddlewareFn(
  value: RestateMiddlewareType,
): value is RestateMiddlewareFn {
  return !isRestateMiddlewareClass(value);
}
