import { TerminalError } from '@restatedev/restate-sdk';
import {
  ReflectionKind,
  Type,
  TypeObjectLiteral,
  TypePropertySignature,
} from '@deepkit/type';
import {
  BSONDeserializer,
  BSONSerializer,
  getBSONDeserializer,
  getBSONSerializer,
} from '@deepkit/bson';

import { getSagaDataType } from './metadata.js';
import {
  RestateHandlerResponse,
  restateHandlerResponseType,
  restateTerminalErrorType,
} from './types.js';

const VALUE_KEY = 'v' as const;

function toSerializableDataType(type: Type): TypeObjectLiteral {
  const parent: TypeObjectLiteral = {
    kind: ReflectionKind.objectLiteral,
    types: [],
  };

  const newType: TypePropertySignature = {
    kind: ReflectionKind.propertySignature,
    name: VALUE_KEY,
    parent,
    type,
  };

  parent.types = [newType];

  return parent;
}

export function getResponseDataSerializer<T>(type: Type): BSONSerializer {
  const serializableType = toSerializableDataType(type);
  const serialize = getBSONSerializer(undefined, serializableType);
  return (value: T) => serialize({ [VALUE_KEY]: value });
}

export function getResponseDataDeserializer<T>(type: Type): BSONDeserializer<T> {
  const serializableType = toSerializableDataType(type);
  const deserialize = getBSONDeserializer<{ readonly [VALUE_KEY]: T }>(
    undefined,
    serializableType,
  );
  return (bson: Uint8Array) => deserialize(bson)[VALUE_KEY];
}

export function getSagaDataDeserializer<T>(
  sagaType: Type,
): BSONDeserializer<T> {
  const dataType = getSagaDataType(sagaType);
  return getBSONDeserializer(undefined, dataType);
}

export function getSagaDataSerializer(sagaType: Type): BSONSerializer {
  const dataType = getSagaDataType(sagaType);
  return getBSONSerializer(undefined, dataType);
}

export const deserializeRestateHandlerResponse =
  getBSONDeserializer<RestateHandlerResponse>(
    undefined,
    restateHandlerResponseType,
  );

export const serializeRestateHandlerResponse = getBSONSerializer(
  undefined,
  restateHandlerResponseType,
);

export const serializeRestateTerminalErrorType = getBSONSerializer(
  undefined,
  restateTerminalErrorType,
);

export const deserializeRestateTerminalErrorType =
  getBSONDeserializer<TerminalError>(undefined, restateTerminalErrorType);
