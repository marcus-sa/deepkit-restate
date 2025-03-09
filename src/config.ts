import { RestateAdminClientOptions } from './admin-client.js';
import { RestateIngressClientOptions } from './client.js';
import { RestateEventConfig } from './event/config.js';
import { RetryOptions } from './utils/retry.js';

// copied from restate
export interface RunOptions {
  /**
   * Max number of retry attempts, before giving up.
   *
   * When giving up, `ctx.run` will throw a `TerminalError` wrapping the original error message.
   */
  maxRetryAttempts?: number;
  /**
   * Max duration of retries, before giving up.
   *
   * When giving up, `ctx.run` will throw a `TerminalError` wrapping the original error message.
   */
  maxRetryDurationMillis?: number;
  /**
   * Initial interval for the first retry attempt.
   * Retry interval will grow by a factor specified in `retryIntervalFactor`.
   *
   * The default is 50 milliseconds.
   */
  initialRetryIntervalMillis?: number;
  /**
   * Max interval between retries.
   * Retry interval will grow by a factor specified in `retryIntervalFactor`.
   *
   * The default is 10 seconds.
   */
  maxRetryIntervalMillis?: number;
  /**
   * Exponentiation factor to use when computing the next retry delay.
   *
   * The default value is `2`, meaning retry interval will double at each attempt.
   */
  retryIntervalFactor?: number;
}

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
  readonly run?: RunOptions;

  get retry(): RetryOptions {
    if (!this.run) {
      return {};
    }
    if (this.run.maxRetryIntervalMillis) {
      console.warn('maxRetryIntervalMillis is not supported');
    }
    return {
      maxAttempts: this.run.maxRetryAttempts,
      maxTimeout: this.run.maxRetryDurationMillis,
      minTimeout: this.run.initialRetryIntervalMillis,
      multiplier: this.run.retryIntervalFactor,
    };
  }
}
