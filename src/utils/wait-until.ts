import {sleep} from "@deepkit/core";

export function waitUntil(
  predicate: () => boolean,
  timeout = 1000,
): Promise<void> {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: <explanation>
  return new Promise<void>(async (resolve, reject) => {
    let wait = true;

    setTimeout(() => {
      wait = false;
      reject(new Error(`Timeout ${timeout}ms exceeded`));
    }, timeout);

    while (wait) {
      if (predicate()) {
        wait = false;
        resolve();
      }
      await sleep(0);
    }
  });
}
