import { Serde, TerminalError } from '@restatedev/restate-sdk';
import {
  deserialize,
  ReceiveType,
  ReflectionKind,
  resolveReceiveType,
  serialize,
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

export function createBSONSerde<T>(type?: ReceiveType<T>) {
  type = resolveReceiveType(type);
  return new BSONSerde<T>(type);
}

export class BSONSerde<T> implements Serde<T> {
  readonly contentType = 'application/octet-stream';

  constructor(private readonly type: Type) {}

  deserialize(data: Uint8Array): T {
    return deserializeResponseData<T>(data, this.type);
  }

  serialize(value: T): Uint8Array {
    return serializeResponseData(value, this.type);
  }
}

export class JSONSerde<T> implements Serde<T> {
  readonly contentType = 'application/json';

  constructor(private readonly type: Type) {}

  deserialize(data: Uint8Array): T {
    return deserialize<T>(
      JSON.parse(data.toString()),
      undefined,
      undefined,
      undefined,
      this.type,
    );
  }

  serialize(value: T): Uint8Array {
    return Buffer.from(
      JSON.stringify(
        serialize<T>(value, undefined, undefined, undefined, this.type),
      ),
    );
  }
}

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

export function getResponseDataSerializer<T>(
  type?: ReceiveType<T>,
): BSONSerializer {
  type = resolveReceiveType(type);
  const serializableType = toSerializableDataType(type);
  const serialize = getBSONSerializer(undefined, serializableType);
  // return (value: T) =>
  //   type.kind !== ReflectionKind.void && type.kind !== ReflectionKind.undefined
  //     ? serialize({ [VALUE_KEY]: value })
  //     : new Uint8Array();
  return (value: T) =>
    value !== undefined ? serialize({ [VALUE_KEY]: value }) : new Uint8Array();
}

export function serializeResponseData<T>(
  data: unknown,
  type?: ReceiveType<T>,
): Uint8Array {
  const serialize = getResponseDataSerializer(type);
  return serialize(data);
}

export function getResponseDataDeserializer<T>(
  type?: ReceiveType<T>,
): BSONDeserializer<T> {
  type = resolveReceiveType(type);
  const serializableType = toSerializableDataType(type);
  const deserialize = getBSONDeserializer<{ readonly [VALUE_KEY]: T }>(
    undefined,
    serializableType,
  );
  // return (bson: Uint8Array) =>
  //   type.kind !== ReflectionKind.void && type.kind !== ReflectionKind.undefined
  //     ? deserialize(bson)[VALUE_KEY]
  //     : (undefined as T);
  return (bson: Uint8Array) =>
    bson.length > 0 ? deserialize(bson)[VALUE_KEY] : (undefined as T);
}

export function deserializeResponseData<T>(
  data: Uint8Array,
  type?: ReceiveType<T>,
): T {
  const deserialize = getResponseDataDeserializer<T>(type);
  return deserialize(data);
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
