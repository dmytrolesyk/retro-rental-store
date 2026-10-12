import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';
import { CookieJar, type SerializedCookieJar } from 'tough-cookie';
import { ClientError } from './errors.js';
import { MATERIALS_ROOT } from './config.js';
import { isRecord } from './http.js';

export interface Session {
  version: 1;
  accessToken: string;
  expiresAt: number;
  cookieJar: SerializedCookieJar;
}

interface SessionTransaction {
  read(): Promise<Session | null>;
  write(session: Session): Promise<void>;
  clear(): Promise<void>;
}

export function sessionDirectory(): string {
  const directory =
    process.env.LMS_SESSION_DIR ?? join(homedir(), '.local/share/retro-games-rental/lms-client');
  const repo = resolve(MATERIALS_ROOT, '..');
  const fromRepo = relative(repo, directory);
  if (
    !isAbsolute(directory) ||
    fromRepo === '' ||
    (!fromRepo.startsWith(`..${sep}`) && !isAbsolute(fromRepo))
  ) {
    throw new ClientError(
      'SESSION_INVALID',
      'LMS_SESSION_DIR має бути абсолютним шляхом поза репозиторієм.',
    );
  }
  return directory;
}

export class SessionStore {
  readonly file: string;
  constructor(readonly directory = sessionDirectory()) {
    this.file = join(directory, 'session.json');
  }

  async transaction<T>(operation: (tx: SessionTransaction) => Promise<T>): Promise<T> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      await chmod(this.directory, 0o700);
    } catch {
      throw new ClientError('SESSION_IO', 'Не вдалося відкрити приватний каталог сесії.');
    }
    const ownership = { compromised: false };
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.file, {
        realpath: false,
        stale: 30_000,
        update: 5_000,
        retries: { retries: 80, minTimeout: 100, maxTimeout: 500, factor: 1.1 },
        onCompromised: () => {
          ownership.compromised = true;
        },
      });
    } catch {
      throw new ClientError('SESSION_BUSY', 'Сесія зайнята іншим процесом. Спробуй пізніше.', 6);
    }
    const assertLocked = () => {
      if (ownership.compromised)
        throw new ClientError('SESSION_BUSY', 'Втрачено блокування сесії. Повтори команду.', 6);
    };
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      const value = await operation({
        read: async () => {
          assertLocked();
          return this.read();
        },
        write: async session => {
          assertLocked();
          await this.write(session, assertLocked);
        },
        clear: async () => {
          assertLocked();
          try {
            await unlink(this.file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
              throw new ClientError('SESSION_IO', 'Не вдалося видалити локальну сесію.');
          }
        },
      });
      outcome = { ok: true, value };
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (!ownership.compromised) {
      try {
        await release();
      } catch {
        // Preserve the original operation error when cleanup also fails.
        if (outcome.ok)
          outcome = {
            ok: false,
            error: new ClientError('SESSION_BUSY', 'Не вдалося звільнити блокування сесії.', 6),
          };
      }
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  private async read(): Promise<Session | null> {
    let file;
    try {
      file = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await file.stat();
      if (!info.isFile() || info.size > 1_048_576) throw new Error();
      await file.chmod(0o600);
      const session: unknown = JSON.parse(await file.readFile('utf8'));
      if (
        !isRecord(session) ||
        session.version !== 1 ||
        typeof session.accessToken !== 'string' ||
        !session.accessToken ||
        typeof session.expiresAt !== 'number' ||
        !Number.isFinite(session.expiresAt) ||
        !isRecord(session.cookieJar) ||
        !Array.isArray(session.cookieJar.cookies)
      )
        throw new Error();
      const cookieJar = CookieJar.deserializeSync(
        JSON.stringify(session.cookieJar),
      ).serializeSync();
      if (!cookieJar) throw new Error();
      return {
        ...session,
        version: 1,
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        cookieJar,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ClientError(
        'SESSION_INVALID',
        'Файл сесії пошкоджений або недоступний. Виконай logout, потім login.',
        4,
      );
    } finally {
      await file?.close();
    }
  }

  private async write(session: Session, assertLocked: () => void): Promise<void> {
    const temporary = join(this.directory, `.session-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(session));
        await file.sync();
      } finally {
        await file.close();
      }
      assertLocked();
      await rename(temporary, this.file);
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError('SESSION_IO', 'Не вдалося атомарно записати сесію.');
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
