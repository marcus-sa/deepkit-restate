export class RestateSseConfig {
  readonly all: boolean = true;
  readonly autoDiscover: boolean = true;
  readonly hosts?: string[];
}

export class RestateEventsServerConfig {
  readonly sse: RestateSseConfig = new RestateSseConfig();
}
