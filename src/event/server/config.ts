export class RestateSseConfig {
  readonly all: boolean = true;
  readonly autoDiscover: boolean = false;
  readonly nodes?: string[];
}

export class RestatePubSubServerConfig {
  readonly sse: RestateSseConfig = new RestateSseConfig();
}
