export class InvocationClient {
  kill() {
  }

  cancel() {}

  purge() {
  }

  #delete() {
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
}

export class RestateAdminClient {
  readonly invocations = new InvocationClient();
  readonly deployments = new DeploymentClient(this);

  constructor(readonly opts: RestateAdminClientOptions) {
  }
}
