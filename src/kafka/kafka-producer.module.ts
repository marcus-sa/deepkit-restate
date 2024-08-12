import { KafkaConfig, ProducerConfig } from 'kafkajs';
import { createModule } from '@deepkit/app';

import { RestateKafkaProducer } from './producer.js';

export class RestateKafkaProducerConfig {
  readonly kafka: KafkaConfig;
  readonly producer?: ProducerConfig;
}

export class RestateKafkaProducerModule extends createModule({
  config: RestateKafkaProducerConfig,
  providers: [RestateKafkaProducer],
  listeners: [RestateKafkaProducer],
  forRoot: true,
}) {
}
