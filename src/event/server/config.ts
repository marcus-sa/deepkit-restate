export class RestateSseConfig {
  readonly all: boolean = true;
  readonly autoDiscover: boolean = false;
  readonly hosts?: string[];
}

export class RestateEventsServerConfig {
  readonly sse: RestateSseConfig = new RestateSseConfig();
}
