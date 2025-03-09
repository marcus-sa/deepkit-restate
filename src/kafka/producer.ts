import { getBSONSerializer } from '@deepkit/bson';
import { eventDispatcher } from '@deepkit/event';
import {
  onServerMainBootstrap,
  onServerMainShutdown,
} from '@deepkit/framework';
import { ReceiveType, resolveReceiveType } from '@deepkit/type';
import { Kafka, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';

import { Context, RestateContextStorage } from '../context.js';
import { RestateKafkaTopic } from '../types.js';
import { RestateKafkaConfig } from './module.js';

import {
  getRestateKafkaTopicArgsType,
  getRestateKafkaTopicSource,
} from '../utils/type.js';

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

  get #ctx(): Pick<Context, 'run'> {
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
  async produce<T extends RestateKafkaTopic<string, any[]>>(
    args: T['args'],
    options?: KafkaProducerPublishOptions,
    type?: ReceiveType<T>,
  ): Promise<readonly RecordMetadata[]> {
    type = resolveReceiveType(type);

    const topic = getRestateKafkaTopicSource(type);
    const argsType = getRestateKafkaTopicArgsType(type);

    const serialize = getBSONSerializer(undefined, argsType);
    const value = Buffer.from(serialize(args));

    // TODO: add name
    return await this.#ctx.run<readonly RecordMetadata[]>(topic, () =>
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
