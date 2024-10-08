import { RestateIngressClientOptions } from './restate-client.js';
import { RestateAdminClientOptions } from './restate-admin-client.js';
import { RestateEventConfig } from './event/config.js';

export class RestateKafkaConfig {
  readonly clusterName: string;
}

export class RestateServerConfig {
  readonly host: string = '0.0.0.0';
  readonly port: number = 9080;
}

export class RestateConfig {
  readonly server?: RestateServerConfig;
  readonly ingress?: RestateIngressClientOptions;
  readonly event?: RestateEventConfig;
  readonly admin?: RestateAdminClientOptions;
  readonly kafka?: RestateKafkaConfig;
}
