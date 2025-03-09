import { TerminalError } from '@restatedev/restate-sdk';

export class ObjectContextNotAllowedError extends TerminalError {
  constructor() {
    super('You cannot use an object context in a service');
  }
}

export class ServiceContextNotAllowedError extends TerminalError {
  constructor() {
    super('You cannot use a service context in an object');
  }
}

export class SagaContextNotAllowedError extends TerminalError {
  constructor() {
    super('You cannot use a saga context outside of a saga');
  }
}
