import { cast, typeSettings } from '@deepkit/type';

export function handleCustomTerminalErrorResponse(message: string): unknown {
  const { data, entityName } = JSON.parse(message) as {
    data: unknown;
    entityName: string;
  };
  const entityType = typeSettings.registeredEntities[entityName];
  return cast(data, undefined, undefined, undefined, entityType);
}
