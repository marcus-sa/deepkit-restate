import { Subject } from 'rxjs';
import { PublishEvent } from '../types.js';

export class Streams extends Map<string, Subject<PublishEvent>> {
  override get(id: string): Subject<PublishEvent> {
    if (!this.has(id)) {
      this.set(id, new Subject());
    }
    return super.get(id)!;
  }
}

export class Clusters extends Map<string, Streams> {
  override get(id: string): Streams {
    if (!this.has(id)) {
      this.set(id, new Streams());
    }
    return super.get(id)!;
  }
}
