import { Serde } from '@restatedev/restate-sdk-core';
import {
  cast,
  ReceiveType,
  ReflectionKind,
  resolveReceiveType,
  serialize,
  Type,
} from '@deepkit/type';
// JSON serialization types
export type JSONSerializer<T = any> = (value: T) => Uint8Array;
export type JSONDeserializer<T = any> = (data: Uint8Array) => T;

export function createJSONSerde<T>(type?: ReceiveType<T>) {
  if (!type) return;
  type = resolveReceiveType(type);
  if (
    type.kind === ReflectionKind.void ||
    type.kind === ReflectionKind.undefined
  )
    return;
  if (type.kind === ReflectionKind.objectLiteral) {
  }
  return new JSONSerde<T>(type);
}

export class JSONSerde<T> implements Serde<T> {
  readonly contentType = 'application/json';

  constructor(private readonly type: Type) {}

  deserialize(data: Uint8Array): T {
    if (data.length === 0) return undefined as T;
    return cast<T>(
      JSON.parse(new TextDecoder().decode(data)),
      undefined,
      undefined,
      undefined,
      this.type,
    );
  }

  serialize(value: T): Uint8Array {
    if (value === undefined) return new Uint8Array();
    return new TextEncoder().encode(
      JSON.stringify(
        serialize<T>(value, undefined, undefined, undefined, this.type),
      ),
    );
  }
}
