export class InvocationClient {
  kill() {}

  cancel() {}
}

export class RestateAdminClient {
  readonly invocation = new InvocationClient();

  constructor(private readonly url: string) {}
}
