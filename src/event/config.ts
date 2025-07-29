export class RestateSseConfig {
  readonly url: string;
}

export class RestatePubSubConfig {
  readonly defaultStream: string = 'all';
  readonly cluster: string = 'default';
  readonly sse?: RestateSseConfig;
}
