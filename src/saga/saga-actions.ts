import { SagaExecutionState } from './saga-execution-state';
import { RestateServiceMethodCall } from '../types';

export class SagaActions<Data> {
  static makeEndState<Data>(state: SagaExecutionState): SagaActions<Data> {
    return new SagaActions<Data>(
      state.compensating,
      true,
      SagaExecutionState.makeEndState(),
    );
  }

  constructor(
    public compensating: boolean = false,
    public endState: boolean = false,
    public updatedState?: SagaExecutionState,
    public updatedData?: Data,
    public local?: boolean,
    public rpc?: RestateServiceMethodCall,
    public localException?: Error,
  ) {}
}
