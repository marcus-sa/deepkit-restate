import { KafkaConfig, ProducerConfig } from 'kafkajs';
import { createModule } from '@deepkit/app';

import { RestateKafkaProducer } from './producer.js';

export class RestateKafkaConfig {
  readonly kafka: KafkaConfig;
  readonly producer?: ProducerConfig;
}

export class RestateKafkaModule extends createModule({
  config: RestateKafkaConfig,
  providers: [RestateKafkaProducer],
  listeners: [RestateKafkaProducer],
  forRoot: true,
}) {
}
