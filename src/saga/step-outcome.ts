import { RestateHandlerRequest } from '../types.js';

export class SagaStepOutcome {
  constructor(
    readonly local: boolean,
    readonly request?: RestateHandlerRequest,
    readonly error?: Error,
  ) {}

  static forLocal(): SagaStepOutcome {
    return new SagaStepOutcome(true);
  }

  static forLocalWithError(error: any): SagaStepOutcome {
    return new SagaStepOutcome(true, undefined, error);
  }

  static forParticipant(request: RestateHandlerRequest): SagaStepOutcome {
    return new SagaStepOutcome(false, request);
  }
}
