import { Kafka, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { getBSONSerializer } from '@deepkit/bson';
import { ReceiveType, resolveReceiveType } from '@deepkit/type';
import { InjectorContext } from '@deepkit/injector';
import type { RunAction } from '@restatedev/restate-sdk/dist/esm/src/context';
import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrap, onServerMainShutdown } from '@deepkit/framework';

import { RestateCustomContext, RestateKafkaTopic, RestateObjectContext, RestateServiceContext } from '../types.js';
import { getRestateKafkaTopicArgsType, getRestateKafkaTopicSource } from '../utils.js';
import { RestateKafkaConfig } from './module.js';

export type KafkaProducerPublishOptions = Pick<
  ProducerRecord,
  'acks' | 'timeout'
>;

export class RestateKafkaProducer {
  readonly #producer: Producer;
  readonly #injectorContext: InjectorContext;

  constructor(config: RestateKafkaConfig, injectorContext: InjectorContext) {
    const kafka = new Kafka(config);
    this.#producer = kafka.producer({
      retry: {
        // controlled by Restate
        retries: 0,
      },
    });
    this.#injectorContext = injectorContext;
  }

  get #ctx(): Pick<RestateCustomContext, 'run'> {
    try {
      return this.#injectorContext.get<RestateServiceContext>();
    } catch {
      try {
        return this.#injectorContext.get<RestateObjectContext>();
      } catch {
        return {
          run: async (action: RunAction<any>) => action(),
        };
      }
    }
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

    return await this.#ctx.run<readonly RecordMetadata[]>(() =>
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
