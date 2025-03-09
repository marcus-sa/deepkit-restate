import { ReceiveType, resolveReceiveType } from '@deepkit/type';
import { serializeResponseData } from '../serde.js';
import { RestateHandlerResponse } from '../types.js';

export function success<T>(
  reply?: T,
  type?: ReceiveType<T>,
): RestateHandlerResponse {
  if (reply) {
    type = resolveReceiveType(type);
    return {
      success: true,
      data: serializeResponseData(reply, type),
      typeName: type.typeName,
    };
  }

  return {
    success: true,
    data: new Uint8Array([]),
  };
}

export function failure<T>(
  reply?: T,
  type?: ReceiveType<T>,
): RestateHandlerResponse {
  if (reply) {
    type = resolveReceiveType(type);
    return {
      success: false,
      data: serializeResponseData(reply, type),
      typeName: type.typeName,
    };
  }

  return {
    success: false,
    data: new Uint8Array([]),
  };
}
