import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { ClientError } from './errors.js';

export async function readCredentials(): Promise<{ email: string; password: string }> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new ClientError(
      'INTERACTIVE_REQUIRED',
      'Для login потрібен інтерактивний термінал. Пароль через аргументи чи pipe не приймається.',
      4,
    );
  }
  let hidden = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      if (!hidden) process.stderr.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  const abort = new AbortController();
  const cancel = () => {
    abort.abort();
  };
  rl.on('SIGINT', cancel);
  rl.on('close', cancel);
  try {
    const email = await rl.question('Email: ', { signal: abort.signal });
    process.stderr.write('Пароль: ');
    hidden = true;
    const password = await rl.question('', { signal: abort.signal });
    process.stderr.write('\n');
    return { email, password };
  } catch {
    throw new ClientError('CANCELLED', 'Вхід скасовано.', 130);
  } finally {
    rl.close();
    output.end();
  }
}
