import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Server } from 'socket.io';
import { runRoomDemo } from '../scripts/realtime-demo.mjs';

async function fixture(t, options = {}) {
  const server = createServer((_request, response) => {
    if (options.httpStall) return;
    response.writeHead(options.httpFailure ? 403 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ rentalId: 'rental-a', status: 'ACTIVE' }));
    if (options.httpFailure || options.silent) return;
    const event = { eventId: 'event-1', rentalId: 'rental-a', status: 'ACTIVE' };
    if (options.leak) io.emit('rental.status', event);
    else io.to('rental-a').emit('rental.status', event);
    if (options.duplicate) io.to('rental-a').emit('rental.status', event);
  });
  const io = new Server(server);
  io.use((_socket, next) => {
    if (!options.authStall) next(options.authFailure ? new Error('Unauthorized') : undefined);
  });
  io.on('connection', socket => {
    socket.on('join', ({ rentalId }, ack) => {
      if (options.noAck) return;
      if (options.joinFailure) return ack({ ok: false, error: { code: 'FORBIDDEN' } });
      socket.join(rentalId);
      ack({ ok: true, rentalId });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    try {
      for (let attempt = 0; attempt < 50 && io.engine.clientsCount > 0; attempt++) await delay(10);
      assert.equal(io.engine.clientsCount, 0, 'demo must disconnect clients even on failure');
    } finally {
      await new Promise(resolve => io.close(resolve));
    }
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    clientToken: 'test-token',
    staffToken: 'test-staff-token',
    rentalA: 'rental-a',
    rentalB: 'rental-b',
    windowMs: 100,
    timeoutMs: 500,
  };
}

test('different rooms measure delivery only to A', async t => {
  assert.deepEqual(await runRoomDemo(await fixture(t)), { aReceived: 1, bReceived: 0 });
});
test('same-room control measures delivery to both clients', async t => {
  assert.deepEqual(await runRoomDemo({ ...(await fixture(t)), sameRoom: true }), {
    aReceived: 1,
    bReceived: 1,
  });
});
test('counts a repeated event ID once', async t => {
  assert.deepEqual(await runRoomDemo(await fixture(t, { duplicate: true })), {
    aReceived: 1,
    bReceived: 0,
  });
});
for (const [name, options] of [
  ['unauthorized socket', { authFailure: true }],
  ['stalled namespace authentication', { authStall: true }],
  ['stalled HTTP command', { httpStall: true }],
  ['rejected join', { joinFailure: true }],
  ['missing join ack', { noAck: true }],
  ['failed HTTP command', { httpFailure: true }],
  ['missing event', { silent: true }],
  ['cross-room leak', { leak: true }],
]) {
  test(`rejects ${name} and disconnects both clients`, async t => {
    await assert.rejects(runRoomDemo(await fixture(t, options)));
  });
}

test('CLI errors return exit 1 without starting the database', async () => {
  await assert.rejects(
    promisify(execFile)(process.execPath, ['scripts/realtime-demo.mjs', '--invalid']),
    error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Realtime demo failed/);
      return true;
    },
  );
});
