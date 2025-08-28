export class RestateSseConfig {
  readonly all?: boolean = true;
  readonly autoDiscover?: boolean = false;
  readonly nodes?: string[];
}

export class RestatePubSubServerConfig {
  readonly defaultStream?: string = 'all';
  readonly cluster?: string = 'default';
  readonly eventVersioning?: boolean = false;
  readonly sse: RestateSseConfig = new RestateSseConfig();
}
