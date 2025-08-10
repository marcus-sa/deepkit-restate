import { Kafka, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { getBSONSerializer } from '@deepkit/bson';
import { ReceiveType, resolveReceiveType } from '@deepkit/type';
import { eventDispatcher } from '@deepkit/event';
import {
  onServerMainBootstrap,
  onServerMainShutdown,
} from '@deepkit/framework';

import { RestateKafkaConfig } from './module.js';
import { RestateBaseContext, RestateKafkaTopic } from '../types.js';
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

  constructor(
    config: RestateKafkaConfig,
    private readonly ctx: RestateBaseContext,
  ) {
    const kafka = new Kafka(config);
    this.#producer = kafka.producer({
      retry: {
        // controlled by Restate
        retries: 0,
      },
    });
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

    return this.ctx.run<readonly RecordMetadata[]>('produce', () =>
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
