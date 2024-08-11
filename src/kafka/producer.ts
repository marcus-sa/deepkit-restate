import { Kafka, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { getBSONSerializer } from '@deepkit/bson';
import { ReceiveType, resolveReceiveType } from '@deepkit/type';
import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap, onServerMainShutdown } from '@deepkit/framework';

import { RestateKafkaTopic } from '../types.js';
import { getRestateKafkaTopicArgsType, getRestateKafkaTopicSource } from '../utils.js';
import { RestateKafkaConfig } from './kafka.module.js';

export type KafkaProducerPublishOptions = Pick<
  ProducerRecord,
  'acks' | 'timeout'
>;

export class RestateKafkaProducer {
  readonly #kafka: Kafka;
  readonly #producer: Producer;

  constructor(config: RestateKafkaConfig) {
    this.#kafka = new Kafka(config.kafka);
    this.#producer = this.#kafka.producer(config.producer);
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

    // TODO: cache serializer
    const serialize = getBSONSerializer(undefined, argsType);
    const value = Buffer.from(serialize(args));

    return await this.#producer.send({
      topic,
      messages: [
        {
          // key,
          value,
        },
      ],
      ...options,
    });
  }
}
