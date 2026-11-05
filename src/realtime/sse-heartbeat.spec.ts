import { finalize, of, Subject, throwError } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import { SSE_HEARTBEAT_MS, withSseHeartbeats } from './sse-heartbeat';

describe('generic Nest SSE heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits comments without IDs while forwarding arbitrary domain messages', () => {
    const source = new Subject<MessageEvent>();
    const received: MessageEvent[] = [];
    const subscription = withSseHeartbeats(source).subscribe(message => received.push(message));
    expect(received).toEqual([{ comment: 'connected' }]);
    const notification = { id: 'notification-1', type: 'notification', data: { text: 'hello' } };
    source.next(notification);
    jest.advanceTimersByTime(SSE_HEARTBEAT_MS);
    expect(received).toEqual([{ comment: 'connected' }, notification, { comment: 'heartbeat' }]);
    subscription.unsubscribe();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ends heartbeat when a source completes synchronously or asynchronously', () => {
    const sync = withSseHeartbeats(of({ id: '1', data: 'done' })).subscribe();
    expect(sync.closed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    const source = new Subject<MessageEvent>();
    const subscription = withSseHeartbeats(source).subscribe();
    source.complete();
    expect(subscription.closed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('uses one source subscription and releases source and timer on disconnect', () => {
    const source = new Subject<MessageEvent>();
    const cleanup = jest.fn();
    const subscription = withSseHeartbeats(source.pipe(finalize(cleanup))).subscribe();
    source.next({ data: 'message' });
    expect(cleanup).not.toHaveBeenCalled();
    subscription.unsubscribe();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans heartbeat on errors without swallowing the error', () => {
    const error = new Error('Source failed');
    const received = jest.fn();
    withSseHeartbeats(throwError(() => error)).subscribe({ error: received });
    expect(received).toHaveBeenCalledWith(error);
    expect(jest.getTimerCount()).toBe(0);
  });
});
