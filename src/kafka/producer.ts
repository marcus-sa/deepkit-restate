import { Kafka, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { getBSONSerializer } from '@deepkit/bson';
import { ReceiveType, resolveReceiveType } from '@deepkit/type';
import { eventDispatcher } from '@deepkit/event';
import {
  onServerMainBootstrap,
  onServerMainShutdown,
} from '@deepkit/framework';

import { RestateKafkaConfig } from './module.js';
import { RestateContextStorage } from '../context-storage.js';
import { RestateCustomContext, RestateKafkaTopic } from '../types.js';
import {
  getRestateKafkaTopicArgsType,
  getRestateKafkaTopicSource,
} from '../metadata.js';
import { RestatePromise } from '@restatedev/restate-sdk';

export type KafkaProducerPublishOptions = Pick<
  ProducerRecord,
  'acks' | 'timeout'
>;

export class RestateKafkaProducer {
  readonly #producer: Producer;
  readonly #contextStorage: RestateContextStorage;

  constructor(
    config: RestateKafkaConfig,
    contextStorage: RestateContextStorage,
  ) {
    const kafka = new Kafka(config);
    this.#producer = kafka.producer({
      retry: {
        // controlled by Restate
        retries: 0,
      },
    });
    this.#contextStorage = contextStorage;
  }

  get #ctx(): Pick<RestateCustomContext, 'run'> {
    return this.#contextStorage.getStore()!;
  }

  @eventDispatcher.listen(onServerMainBootstrap)
  async connect() {
    await this.#producer.connect();
  }

  @eventDispatcher.listen(onServerMainShutdown)
  async disconnect() {
    await this.#producer.disconnect();
  }

  // TODO: add key parameter
  produce<T extends RestateKafkaTopic<string, any[]>>(
    args: T['args'],
    options?: KafkaProducerPublishOptions,
    type?: ReceiveType<T>,
  ): RestatePromise<readonly RecordMetadata[]> {
    type = resolveReceiveType(type);

    const topic = getRestateKafkaTopicSource(type);
    const argsType = getRestateKafkaTopicArgsType(type);

    const serialize = getBSONSerializer(undefined, argsType);
    const value = Buffer.from(serialize(args));

    return this.#ctx.run<readonly RecordMetadata[]>('produce', () =>
      this.#producer.send({
        topic,
        messages: [
          {
            // key,
            value,
          },
        ],
        ...options,
      }),
    );
  }
}
