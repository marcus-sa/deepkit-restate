import { Positive } from '@deepkit/type';
import { RestateAdminClientOptions } from './admin-client.js';
import { RestateIngressClientOptions } from './client.js';
import { RestateEventConfig } from './event/config.js';
import { RetryOptions } from './utils/retry.js';

export class RestateKafkaConfig {
  clusterName: string;
}

export class RestateServerConfig {
  host = '0.0.0.0';
  port = 9080;
}

export class RestateRunConfig {
  /**
   * Max number of retry attempts, before giving up
   */
  maxRetryAttempts?: number;
  /**
   * Max duration of retries, before giving up.
   */
  maxRetryDurationMillis?: number;
  /**
   * Initial interval for the first retry attempt.
   * Retry interval will grow by a factor specified in `retryIntervalFactor`.
   */
  initialRetryIntervalMillis: number & Positive = 50;
  /**
   * Max interval between retries.
   * Retry interval will grow by a factor specified in `retryIntervalFactor`.
   */
  // maxRetryIntervalMillis: number & Positive = 10_000;
  /**
   * Exponentiation factor to use when computing the next retry delay.
   * The default value is `2`, meaning retry interval will double at each attempt.
   */
  retryIntervalFactor: number & Positive = 2;
}

export class RestateConfig {
  server?: RestateServerConfig;
  ingress?: RestateIngressClientOptions;
  event?: RestateEventConfig;
  admin?: RestateAdminClientOptions;
  kafka?: RestateKafkaConfig;
  run = new RestateRunConfig();

  get retry(): RetryOptions {
    // if (this.run.maxRetryIntervalMillis) {
    //   console.warn('maxRetryIntervalMillis is not supported');
    // }
    return {
      maxAttempts: this.run.maxRetryAttempts,
      maxTimeout: this.run.maxRetryDurationMillis,
      minTimeout: this.run.initialRetryIntervalMillis,
      multiplier: this.run.retryIntervalFactor,
    };
  }
}
