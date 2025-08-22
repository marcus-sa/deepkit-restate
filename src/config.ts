import {
  RestateAdminClientOptions,
  RestateIngressClientOptions,
} from './client/index.js';
import { RestatePubSubConfig } from './event/config.js';

// indicates that it is a custom error that has to be deserialized
export const CUSTOM_TERMINAL_ERROR_CODE = 1001;

export class RestateKafkaConfig {
  readonly clusterName: string;
}

export class RestateServerConfig {
  readonly host?: string;
  readonly port?: number = 9080;
  /**
   * Controls whether incoming request headers are propagated to outgoing service calls.
   * This is useful for passing authentication tokens, correlation IDs, or other
   * context information through the service call chain.
   */
  readonly propagateIncomingHeaders?: string[];
  // Indicates whether BSON (Binary JSON) is enabled.
  readonly bson?: boolean;
}

export class RestateConfig {
  readonly server?: RestateServerConfig;
  readonly ingress?: RestateIngressClientOptions;
  readonly pubsub?: RestatePubSubConfig;
  readonly admin?: RestateAdminClientOptions;
  readonly kafka?: RestateKafkaConfig;
}
