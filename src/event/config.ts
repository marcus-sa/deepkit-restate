export class RestateEventConfig {
  readonly defaultStream: string = 'all';
  readonly cluster: string = 'default';
  readonly host?: string;
  readonly port?: number;
}
