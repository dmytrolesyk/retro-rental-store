import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

/** Measure the same command with two clients; only B's room changes in control mode. */
export async function runRoomDemo({
  url,
  clientToken,
  staffToken,
  rentalA,
  rentalB,
  sameRoom = false,
  windowMs = 1500,
  timeoutMs = 5000,
}) {
  const clients = [];
  const received = [new Set(), new Set()];
  let observing = false;
  let connectionFailed = false;
  try {
    for (let index = 0; index < 2; index++) {
      const socket = io(url, {
        auth: { token: clientToken },
        autoConnect: false,
        reconnection: false,
        transports: ['websocket'],
        timeout: timeoutMs,
      });
      clients.push(socket);
      socket.on('disconnect', () => {
        connectionFailed = true;
      });
      socket.on('rental.status', event => {
        if (
          observing &&
          event?.rentalId === rentalA &&
          event.status === 'ACTIVE' &&
          typeof event.eventId === 'string'
        ) {
          received[index].add(event.eventId);
        }
      });
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer);
          socket.off('connect', connected);
          socket.off('connect_error', failed);
          if (error) reject(error);
          else resolve();
        };
        const connected = () => finish();
        const failed = () => finish(new Error('Socket authentication or connection failed'));
        // Socket.IO's timeout only covers transport opening, not namespace authentication.
        const timer = setTimeout(() => finish(new Error('Socket connection timed out')), timeoutMs);
        socket.once('connect', connected);
        socket.once('connect_error', failed);
        socket.connect();
      });
      const rentalId = index === 0 || sameRoom ? rentalA : rentalB;
      const ack = await socket.timeout(timeoutMs).emitWithAck('join', { rentalId });
      if (ack?.ok !== true || ack.rentalId !== rentalId) throw new Error('Rental room join failed');
    }
    observing = true;
    const response = await fetch(`${url}/rentals/${rentalA}/issue`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Issue command failed: HTTP ${response.status}`);
    const rental = await response.json();
    if (rental.rentalId !== rentalA || rental.status !== 'ACTIVE')
      throw new Error('Unexpected issue response');
    // Observe the entire window: absence at B cannot be checked at A's first message.
    await delay(windowMs);
    if (connectionFailed || clients.some(socket => !socket.connected))
      throw new Error('Socket disconnected during observation');
    const result = { aReceived: received[0].size, bReceived: received[1].size };
    console.log(`A_RECEIVED=${result.aReceived}`);
    console.log(`B_RECEIVED=${result.bReceived}`);
    if (result.aReceived !== 1 || result.bReceived !== Number(sameRoom))
      throw new Error('Unexpected room delivery counts');
    if (sameRoom && [...received[0]][0] !== [...received[1]][0])
      throw new Error('Clients received different events');
    return result;
  } finally {
    for (const socket of clients) {
      socket.disconnect();
      socket.removeAllListeners();
    }
  }
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--same-room'))
    throw new Error('Usage: node scripts/realtime-demo.mjs [--same-room]');
  // Load compiled backend only for CLI execution, after argument validation.
  const { createRealtimeDemoFixture } = await import('../dist/scripts/realtime-demo-fixture.js');
  const fixture = await createRealtimeDemoFixture();
  try {
    console.log(`MODE=${process.argv.includes('--same-room') ? 'same-room' : 'different-rooms'}`);
    await runRoomDemo({ ...fixture, sameRoom: process.argv.includes('--same-room') });
  } finally {
    await fixture.close();
  }
}

if (import.meta.main) {
  main().catch(() => {
    // Do not serialize errors that might contain generated credentials or DB connection strings.
    console.error('Realtime demo failed. Check build, Docker and the measured delivery counts.');
    process.exitCode = 1;
  });
}
