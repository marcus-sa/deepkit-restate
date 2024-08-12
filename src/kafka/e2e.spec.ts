import { createTestingApp } from '@deepkit/framework';
import { uuid, UUID } from '@deepkit/type';

import { RestateKafkaTopic, RestateService } from '../types.js';
import { restate } from '../decorator.js';
import { RestateModule } from '../restate.module.js';
import { RestateKafkaProducerModule } from './module.js';
import { RestateKafkaProducer } from './producer.js';

test('e2e', async () => {
  class Consumer {
    readonly id: UUID = uuid();
  }

  interface IAccountingService {
    createAccount(consumer: Consumer): void;
  }

  type KafkaConsumerCreatedTopic = RestateKafkaTopic<
    'consumer-created',
    [consumer: Consumer]
  >;

  type AccountingServiceApi = RestateService<'accounting', IAccountingService>;

  @restate.service<AccountingServiceApi>()
  class AccountingService implements IAccountingService {
    // FIXME: options and type are somehow required
    // @ts-ignore
    @restate.kafka<KafkaConsumerCreatedTopic>().handler()
    createAccount(consumer: Consumer): void {
      expect(consumer).toBeInstanceOf(Consumer);
    }
  }

  const app = createTestingApp({
    imports: [
      new RestateModule({
        host: 'http://host.docker.internal',
        port: 9084,
        kafka: {
          clusterName: 'restate',
        },
        admin: {
          url: 'http://0.0.0.0:9070',
        },
        ingress: {
          url: 'http://0.0.0.0:8080',
        },
      }),
      new RestateKafkaProducerModule({
        clientId: 'e2e',
        brokers: ['0.0.0.0:9092'],
      }),
    ],
    controllers: [AccountingService],
  });
  await app.startServer();

  const injector = app.app.getInjectorContext();
  const kafka = injector.get<RestateKafkaProducer>();

  await kafka.produce<KafkaConsumerCreatedTopic>([new Consumer()]);
});
