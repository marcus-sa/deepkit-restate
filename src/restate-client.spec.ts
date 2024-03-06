import { RestateClient } from './restate-client';
import { RestateService } from './types';
import { uuid } from '@deepkit/type';

test.skip('RestateClient', async () => {
  interface PaymentServiceInterface {
    send(username: string, amount: number): Promise<string>;
  }

  type PaymentServiceApi = RestateService<
    'payment',
    PaymentServiceInterface,
    { keyed: true }
  >;

  const client = new RestateClient('http://localhost:8080', {
    authToken: '',
  });

  const payments = client.service<PaymentServiceApi>();

  const response = await client.rpc(payments.send('marcus-sa', 1000), {
    key: uuid(),
  });
  console.log(response);
});
