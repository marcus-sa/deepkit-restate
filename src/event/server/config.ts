export class RestateEventsServerConfig {
  readonly sse: boolean = true;
  readonly autoDiscover: boolean = true;
  readonly hosts?: string[];
}
