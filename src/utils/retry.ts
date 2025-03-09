import { sleep } from '@deepkit/core';
import { TerminalError } from '@restatedev/restate-sdk';

export class RetryError extends TerminalError {
  constructor(cause: unknown, attempts: number) {
    super(`Retrying exceeded the maxAttempts (${attempts})`, { cause });
  }
}

export interface RetryOptions {
  multiplier?: number;
  maxTimeout?: number;
  maxAttempts?: number;
  minTimeout?: number;
}

export function exponentialBackoff(
  cap: number,
  base: number,
  attempt: number,
  multiplier: number,
) {
  const exp = Math.min(cap, base * multiplier ** attempt);
  return Math.random() * exp;
}

export async function retry<T>(
  fn: () => T | Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  // https://docs.restate.dev/references/server_config#default-configuration
  const {
    multiplier = 2,
    maxTimeout = 3_000,
    maxAttempts = 10,
    minTimeout = 250,
  } = options ?? {};

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof TerminalError) {
        throw error;
      }
      if (attempt + 1 >= maxAttempts) {
        throw new RetryError(error, maxAttempts);
      }

      const timeout = exponentialBackoff(
        maxTimeout,
        minTimeout,
        attempt,
        multiplier,
      );
      await sleep(timeout);
    }
    attempt++;
  }
}
