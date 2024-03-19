import { RestateServiceMethodRequest } from '../types.js';

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

  constructor(
    readonly local: boolean,
    readonly request?: RestateServiceMethodRequest,
    readonly error?: Error,
  ) {}
}
