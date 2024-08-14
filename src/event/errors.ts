import { entity, Type } from '@deepkit/type';

@entity.name('@error/subscription-not-found')
export class SubscriptionNotFound extends Error {}

@entity.name('@error/type-no-match')
export class SubscriptionTypeNoMatch extends Error {}

@entity.name('@error/missing-type-name')
export class MissingTypeName extends Error {
  constructor(readonly type: Type) {
    super('Missing type name');
  }
}
