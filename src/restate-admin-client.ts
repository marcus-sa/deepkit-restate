export class InvocationClient {
  kill() {}

  cancel() {}
}

export class DeploymentClient {
  constructor(private readonly base: RestateAdminClient) {}

  async create(uri: string): Promise<Response> {
    const response = await fetch(`${this.base.url}/deployments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uri }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
  }
}

export class RestateAdminClient {
  readonly invocations = new InvocationClient();
  readonly deployments = new DeploymentClient(this);

  constructor(readonly url: string) {}
}
