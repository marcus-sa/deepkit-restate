import { createModuleClass } from '@deepkit/app';

import { RestateKafkaProducer } from './producer.js';

export class RestateKafkaConfig {
  readonly brokers: string[];
  readonly clientId?: string;
}

export class RestateKafkaProducerModule extends createModuleClass({
  config: RestateKafkaConfig,
  providers: [RestateKafkaProducer],
  listeners: [RestateKafkaProducer],
  forRoot: true,
}) {}
