import { ClassType } from '@deepkit/core';
import {
  assertType,
  ReflectionKind,
  Type,
  TypeClass,
  TypeObjectLiteral,
  TypeTuple,
} from '@deepkit/type';

import { getTypeArgument } from './utils.js';
import {
  restateObjectDecorator,
  RestateObjectMetadata,
  restateSagaDecorator,
  RestateSagaMetadata,
  restateServiceDecorator,
  RestateServiceMetadata,
} from './decorator.js';

export function getRestateClassName(serviceType: Type): string {
  const typeArgument = getTypeArgument(serviceType, 0);
  assertType(typeArgument, ReflectionKind.literal);
  return typeArgument.literal as string;
}

export function getSagaDataType(sagaType: Type): TypeObjectLiteral | TypeClass {
  const typeArgument = getTypeArgument(sagaType, 1);
  if (
    typeArgument?.kind !== ReflectionKind.objectLiteral &&
    typeArgument?.kind !== ReflectionKind.class
  ) {
    throw new Error('Invalid saga data type');
  }
  return typeArgument;
}

export function getRestateServiceMetadata(
  classType: ClassType,
): RestateServiceMetadata | undefined {
  const metadata = restateServiceDecorator._fetch(classType);
  return metadata?.name ? metadata : undefined;
}

export function getRestateObjectMetadata(
  classType: ClassType,
): RestateObjectMetadata | undefined {
  const metadata = restateObjectDecorator._fetch(classType);
  return metadata?.name ? metadata : undefined;
}

export function getRestateSagaMetadata<T>(
  classType: ClassType,
): RestateSagaMetadata<T> | undefined {
  const metadata = restateSagaDecorator._fetch(classType);
  return metadata?.name ? (metadata as RestateSagaMetadata<T>) : undefined;
}

export function getRestateKafkaTopicSource(type: Type): string {
  const typeArgument = getTypeArgument(type, 0);
  assertType(typeArgument, ReflectionKind.literal);
  if (!(typeof typeArgument.literal === 'string')) {
    throw new Error('Value must be a string');
  }
  return typeArgument.literal;
}

export function getRestateKafkaTopicArgsType(type: Type): TypeTuple {
  const typeArgument = getTypeArgument(type, 1);
  assertType(typeArgument, ReflectionKind.tuple);
  return typeArgument;
}
