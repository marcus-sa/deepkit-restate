import { Subject } from 'rxjs';
import { PublishEvent } from '../types.js';

export type EventsSubject = Subject<PublishEvent>;
