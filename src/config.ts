import { RestateIngressClientOptions } from './restate-ingress-client.js';
import { RestateAdminClientOptions } from './restate-admin-client.js';
import { RestatePubSubConfig } from './event/config.js';

// indicates that it is a custom error that has to be deserialized
export const CUSTOM_TERMINAL_ERROR_CODE = 1001;

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
  readonly pubsub?: RestatePubSubConfig;
  readonly admin?: RestateAdminClientOptions;
  readonly kafka?: RestateKafkaConfig;
}
