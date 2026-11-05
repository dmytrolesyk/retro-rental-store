import type { MessageEvent } from '@nestjs/common';
import { defer, finalize, interval, map, merge, ReplaySubject, startWith, takeUntil } from 'rxjs';
import type { Observable } from 'rxjs';

export const SSE_HEARTBEAT_MS = 15000;

/** Comment frames keep idle connections alive without changing the event cursor. */
export function withSseHeartbeats(messages: Observable<MessageEvent>): Observable<MessageEvent> {
  return defer(() => {
    const done = new ReplaySubject<void>(1);
    const data = messages.pipe(
      finalize(() => {
        done.next();
        done.complete();
      }),
    );
    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(
      map(() => ({ comment: 'heartbeat' })),
      takeUntil(done),
    );
    return merge(data, heartbeat).pipe(startWith({ comment: 'connected' }));
  });
}
