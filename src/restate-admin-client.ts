export class InvocationClient {
  kill() {
  }

  cancel() {}

  purge() {
  }

  #delete() {
  }
}

export interface KafkaSubscriptionsCreateOptions {
  readonly source: string;
  readonly sink: string;
  readonly options?: Record<string, string>;
}

export class KafkaSubscriptionsClient {
  constructor(private readonly client: RestateAdminClient) {
  }

  async create({ source, sink, options }: KafkaSubscriptionsCreateOptions): Promise<Response> {
    const url = `${this.client.opts.url}/subscriptions`;

    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        source,
        sink,
        options,
      }),
      headers: {
        'content-type': 'application/json',
      },
    });
    if (response.status !== 201) {
      throw new Error(await response.text());
    }
    return response;
  }
}

export class KafkaClient {
  readonly subscriptions: KafkaSubscriptionsClient;

  constructor(client: RestateAdminClient) {
    this.subscriptions = new KafkaSubscriptionsClient(client);
  }
}

export class DeploymentClient {
  constructor(private readonly client: RestateAdminClient) {
  }

  async create(uri: string): Promise<any> {
    const response = await fetch(`${this.client.opts.url}/deployments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uri }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return await response.json();
  }
}

export class RestateAdminClientOptions {
  readonly url: string;
  readonly autoDeploy?: boolean = true;
}

export class RestateAdminClient {
  readonly invocations = new InvocationClient();
  readonly deployments = new DeploymentClient(this);
  readonly kafka = new KafkaClient(this);

  constructor(readonly opts: RestateAdminClientOptions) {
  }
}
