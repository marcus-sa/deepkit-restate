import { RestateServiceMethodRequest } from '../types';

export class SagaStepOutcome {
  static forParticipant(request: RestateServiceMethodRequest): SagaStepOutcome {
    return new SagaStepOutcome(false, request);
  }

  static forLocal(): SagaStepOutcome {
    return new SagaStepOutcome(true);
  }

  static forLocalWithError(error: any): SagaStepOutcome {
    return new SagaStepOutcome(true, undefined, error);
  }

  static create(result: any): SagaStepOutcome {
    return result instanceof RestateServiceMethodRequest
      ? SagaStepOutcome.forParticipant(result)
      : SagaStepOutcome.forLocal();
  }

  constructor(
    readonly local: boolean,
    readonly request?: RestateServiceMethodRequest,
    readonly error?: Error,
  ) {}
}
