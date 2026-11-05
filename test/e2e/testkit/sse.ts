import { request } from 'node:http';
import { EventEmitter, once } from 'node:events';
import type { RentalStatusChanged } from '../../../src/rentals/rental-status-event';

export async function openEventStream(url: string, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number | undefined;
    contentType: string | undefined;
    frames: string[];
    events(count: number): Promise<RentalStatusChanged[]>;
    ready(): Promise<void>;
    closed(): Promise<void>;
    close(): void;
  }>((resolve, reject) => {
    const req = request(url, { headers, agent: false }, response => {
      req.setTimeout(0);
      response.setEncoding('utf8');
      let buffer = '';
      let ended = false;
      const frames: string[] = [];
      const events: RentalStatusChanged[] = [];
      const changes = new EventEmitter();
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary).replace(/^\n+/, '');
          buffer = buffer.slice(boundary + 2);
          if (!frame) continue;
          frames.push(frame);
          if (frame.includes('event: rental.status\n')) {
            const data = frame.split('\n').find(line => line.startsWith('data: '));
            if (data) events.push(JSON.parse(data.slice(6)) as RentalStatusChanged);
          }
        }
        changes.emit('change');
      });
      response.on('close', () => {
        ended = true;
        changes.emit('change');
      });
      response.on('error', () => {
        ended = true;
        changes.emit('change');
      });
      async function waitFor(check: () => boolean, allowClosed = false) {
        while (!check()) {
          if (ended && !allowClosed) throw new Error('SSE closed before expected events');
          await once(changes, 'change', { signal: AbortSignal.timeout(5000) });
        }
      }
      resolve({
        status: response.statusCode,
        contentType: response.headers['content-type'],
        frames,
        async events(count) {
          await waitFor(() => events.length >= count);
          return events.slice(0, count);
        },
        async ready() {
          await waitFor(() => frames.length > 0);
        },
        async closed() {
          await waitFor(() => ended, true);
        },
        close() {
          response.destroy();
          req.destroy();
        },
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('SSE connection timed out')));
    req.end();
  });
}
