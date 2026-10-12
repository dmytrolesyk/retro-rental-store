import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import lockfile from 'proper-lockfile';
import { isRecord } from './http.js';
import { ClientError } from './errors.js';

export interface CachedFile {
  file: string;
  bytes: number;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  sha256: string;
}
export async function validCachedFile(cache: CachedFile): Promise<boolean> {
  try {
    await checkTarget(cache.file);
    return await matchesState(cache.file, {
      ...cache,
      version: 1,
      identity: '',
      total: cache.bytes,
      validator: null,
      complete: true,
    });
  } catch {
    return false;
  }
}
export type FileKind = 'pdf' | 'text' | 'vtt' | 'file';
export interface DownloadOptions {
  kind: FileKind;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  validateFile?: (temporaryPath: string) => Promise<void>;
  cache?: CachedFile;
  referer?: string;
}
export function safeName(value: string): string {
  return (
    value
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unnamed'
  );
}

// Check every component rather than following a symlink through recursive mkdir.
export async function ensureDirectory(directory: string): Promise<void> {
  const absolute = resolve(directory);
  let current = parse(absolute).root;
  for (const segment of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ClientError('FILE_IO', 'Небезпечний шлях до каталогу матеріалів.');
  }
}
async function checkTarget(target: string): Promise<void> {
  await ensureDirectory(dirname(target));
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink())
      throw new ClientError('FILE_IO', 'Шлях матеріалу не є звичайним файлом.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}
export async function writeLocalFile(
  target: string,
  text: string,
  beforeCommit?: () => void,
): Promise<void> {
  const temporary = `${target}.part-${randomUUID()}`;
  try {
    await checkTarget(target);
    await writeFile(temporary, text, { flag: 'wx' });
    beforeCommit?.();
    await rename(temporary, target);
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('FILE_IO', 'Не вдалося записати локальний матеріал.');
  } finally {
    await rm(temporary, { force: true });
  }
}
function checkedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ClientError('DOWNLOAD_UNSUPPORTED', 'Некоректне посилання на файл.', 5);
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new ClientError(
      'DOWNLOAD_UNSUPPORTED',
      'Файли завантажуються лише через HTTPS без credentials у URL.',
      5,
    );
  if (url.hostname === 'accounts.google.com')
    throw new ClientError('DOWNLOAD_UNAVAILABLE', 'Файл потребує окремого входу.', 5);
  return url;
}
function validatePrefix(prefix: Buffer, kind: FileKind): void {
  const text = prefix
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (/^(?:<!doctype\s+html|<html|<head|<body|<\?xml)/i.test(text))
    throw new ClientError(
      'DOWNLOAD_UNAVAILABLE',
      'Джерело повернуло сторінку входу або помилки замість файла.',
      5,
    );
  if (kind === 'pdf' && !prefix.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new ClientError('DOWNLOAD_INVALID', 'Файл не має сигнатури PDF.', 5);
  if (kind === 'vtt' && !/^WEBVTT(?:\s|$)/.test(text))
    throw new ClientError('DOWNLOAD_INVALID', 'Файл не має заголовка WEBVTT.', 5);
}

export async function downloadFile(url: string, target: string, options: DownloadOptions) {
  const temporary = `${target}.part-${randomUUID()}`;
  const maxBytes =
    options.maxBytes ??
    (options.kind === 'text' || options.kind === 'vtt' ? 10_000_000 : 100_000_000);
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 30_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  let response: Response | undefined;
  try {
    await checkTarget(target);
    const cache =
      options.cache && (await validCachedFile(options.cache)) ? options.cache : undefined;
    const headers: Record<string, string> = options.referer
      ? { Referer: checkedUrl(options.referer).href }
      : {};
    let redirected = false;
    if (cache?.etag && /^"[^"\r\n]+"$/.test(cache.etag)) headers['If-None-Match'] = cache.etag;
    else if (cache?.lastModified && Number.isFinite(Date.parse(cache.lastModified)))
      headers['If-Modified-Since'] = cache.lastModified;
    let next = checkedUrl(url);
    for (let attempt = 0; attempt <= 5; attempt++) {
      response = await (options.fetchImpl ?? fetch)(next, { redirect: 'manual', signal, headers });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      redirected = true;
      // A validator belongs to a representation at a URI, not to a redirect target.
      delete headers['If-None-Match'];
      delete headers['If-Modified-Since'];
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || attempt === 5)
        throw new ClientError(
          'DOWNLOAD_UNAVAILABLE',
          'Джерело не віддало файл після перенаправлень.',
          5,
        );
      next = checkedUrl(new URL(location, next).href);
    }
    if (
      response?.status === 304 &&
      cache &&
      (headers['If-None-Match'] || headers['If-Modified-Since'])
    )
      return { ...cache, status: 'unchanged' as const };
    if (!response?.ok || !response.body)
      throw new ClientError('DOWNLOAD_UNAVAILABLE', 'Файл недоступний на джерелі.', 5);
    const contentType =
      (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (/html|xml|json/.test(contentType))
      throw new ClientError(
        'DOWNLOAD_UNAVAILABLE',
        'Джерело повернуло документ помилки замість файла.',
        5,
      );
    const allowed =
      options.kind === 'pdf'
        ? ['application/pdf', 'application/octet-stream']
        : options.kind === 'vtt' || options.kind === 'text'
          ? ['text/plain', 'text/markdown', 'text/vtt', 'application/octet-stream']
          : null;
    if (allowed && !allowed.includes(contentType))
      throw new ClientError('DOWNLOAD_INVALID', 'Джерело повернуло неочікуваний тип файла.', 5);
    const length = response.headers.get('content-length');
    const expected =
      length !== null && !response.headers.get('content-encoding') ? Number(length) : null;
    if (
      expected !== null &&
      (!Number.isSafeInteger(expected) || expected <= 0 || expected > maxBytes)
    )
      throw new ClientError('DOWNLOAD_INVALID', 'Некоректний або завеликий розмір файла.', 5);
    let bytes = 0;
    const prefix: Buffer[] = [];
    let prefixBytes = 0;
    const decoder =
      options.kind === 'text' || options.kind === 'vtt'
        ? new TextDecoder('utf-8', { fatal: true })
        : null;
    const validator = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          bytes += chunk.length;
          if (bytes > maxBytes)
            throw new ClientError('DOWNLOAD_INVALID', 'Файл перевищує дозволений розмір.', 5);
          if (prefixBytes < 512) {
            const part = chunk.subarray(0, 512 - prefixBytes);
            prefix.push(part);
            prefixBytes += part.length;
          }
          if (decoder) {
            const text = decoder.decode(chunk, { stream: true });
            if (text.includes('\0'))
              throw new ClientError('DOWNLOAD_INVALID', 'Очікувався текстовий файл.', 5);
          }
          callback(null, chunk);
        } catch (error) {
          callback(error instanceof Error ? error : new Error('Invalid stream'));
        }
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      validator,
      createWriteStream(temporary, { flags: 'wx' }),
      { signal },
    );
    decoder?.decode();
    if (!bytes || (expected !== null && bytes !== expected))
      throw new ClientError('DOWNLOAD_INVALID', 'Файл завантажився не повністю.', 5);
    validatePrefix(Buffer.concat(prefix), options.kind);
    await options.validateFile?.(temporary);
    const sha256 = (await fileDigest(temporary)).sha256;
    await rename(temporary, target);
    return {
      file: target,
      bytes,
      contentType,
      etag: redirected ? null : response.headers.get('etag'),
      lastModified: redirected ? null : response.headers.get('last-modified'),
      sha256,
      status: 'downloaded' as const,
    };
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('DOWNLOAD_FAILED', 'Не вдалося завантажити файл повністю.', 5);
  } finally {
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

export interface VideoSource {
  url: string;
  identity: string;
  referer?: string;
}
interface VideoDownloadOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  attempts?: number;
  idleTimeoutMs?: number;
  onProgress?: (bytes: number, total: number) => void;
  availableBytes?: (directory: string) => Promise<number>;
}
interface VideoState {
  version: 1;
  identity: string;
  total: number;
  validator: string | null;
  bytes: number;
  sha256: string;
  complete: boolean;
}
function videoError(message: string): never {
  throw new ClientError('DOWNLOAD_INVALID', message, 5);
}
function validatorFor(response: Response): string | null {
  const etag = response.headers.get('etag');
  if (etag && /^"[^"\r\n]+"$/.test(etag)) return etag;
  const modified = response.headers.get('last-modified');
  return modified && Number.isFinite(Date.parse(modified)) ? modified : null;
}
function videoHeaders(response: Response): void {
  if ([401, 403, 408, 429].includes(response.status) || response.status >= 500)
    throw new ClientError(
      'DOWNLOAD_UNAVAILABLE',
      'Відео недоступне; нове посилання не допомогло.',
      5,
    );
  if (![200, 206].includes(response.status) || !response.body)
    videoError('Джерело не віддало відеофайл.');
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (
    !['video/mp4', 'application/octet-stream'].includes(type ?? '') ||
    response.headers.has('content-encoding')
  )
    videoError('Очікувався нестиснений MP4, а не сторінка чи інший формат.');
}
function rangeFor(response: Response): { start: number; end: number; total: number } {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  if (!match) videoError('Некоректний Content-Range відео.');
  const start = Number(match[1]),
    end = Number(match[2]),
    total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || end >= total)
    videoError('Некоректні межі Content-Range відео.');
  return { start, end, total };
}
async function fileDigest(file: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}
async function videoState(file: string): Promise<VideoState | null> {
  try {
    const info = await lstat(file);
    if (info.size > 8192) return null;
    const state: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (
      !isRecord(state) ||
      state.version !== 1 ||
      typeof state.identity !== 'string' ||
      typeof state.total !== 'number' ||
      !Number.isSafeInteger(state.total) ||
      state.total <= 0 ||
      (state.validator !== null && typeof state.validator !== 'string') ||
      typeof state.bytes !== 'number' ||
      !Number.isSafeInteger(state.bytes) ||
      state.bytes < 0 ||
      typeof state.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(state.sha256) ||
      typeof state.complete !== 'boolean'
    )
      return null;
    return state as unknown as VideoState;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
      return null;
    throw error;
  }
}
async function matchesState(file: string, state: VideoState): Promise<boolean> {
  try {
    if ((await lstat(file)).size !== state.bytes) return false;
    const digest = await fileDigest(file);
    return digest.sha256 === state.sha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

// Signed URLs remain in memory. A byte-range GET probes size/identity: some CDNs reject HEAD.
export async function downloadVideo(
  freshSource: () => Promise<VideoSource>,
  target: string,
  options: VideoDownloadOptions = {},
) {
  const part = `${target}.part`,
    metadata = `${target}.json`;
  const ownership = new AbortController();
  const signal = AbortSignal.any([ownership.signal, ...(options.signal ? [options.signal] : [])]);
  const assertActive = () => {
    if (ownership.signal.aborted)
      throw new ClientError('VIDEO_BUSY', 'Втрачено блокування відеофайла.', 6);
    if (options.signal?.aborted)
      throw new ClientError(
        'CANCELLED',
        'Завантаження скасовано; безпечну частину збережено.',
        130,
      );
  };
  assertActive();
  let release: (() => Promise<void>) | undefined;
  try {
    for (const path of [target, part, metadata]) await checkTarget(path);
    try {
      release = await lockfile.lock(target, {
        realpath: false,
        stale: 30_000,
        update: 5_000,
        retries: 0,
        onCompromised: () => {
          ownership.abort();
        },
      });
    } catch {
      throw new ClientError('VIDEO_BUSY', 'Цей відеофайл уже завантажує інший процес.', 6);
    }
    const attempts = Math.min(3, Math.max(1, options.attempts ?? 3));
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      assertActive();
      let response: Response | undefined;
      let state: VideoState | null = null;
      let writing = false;
      const idle = new AbortController();
      const requestSignal = AbortSignal.any([signal, idle.signal]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          idle.abort();
        }, options.idleTimeoutMs ?? 30_000);
      };
      touch();
      const request = async (url: string, headers: Record<string, string>) => {
        let next = checkedUrl(url);
        for (let hop = 0; hop <= 5; hop++) {
          const result = await (options.fetchImpl ?? fetch)(next, {
            headers,
            signal: requestSignal,
            redirect: 'manual',
          });
          if (![301, 302, 303, 307, 308].includes(result.status)) return result;
          await result.body?.cancel();
          const location = result.headers.get('location');
          if (!location || hop === 5) videoError('Забагато перенаправлень відео.');
          next = checkedUrl(new URL(location, next).href);
        }
        throw new Error('Unreachable');
      };
      try {
        const source = await freshSource();
        assertActive();
        const publicHeaders: Record<string, string> = source.referer
          ? { Referer: checkedUrl(source.referer).href }
          : {};
        response = await request(source.url, {
          ...publicHeaders,
          Range: 'bytes=0-0',
          'Accept-Encoding': 'identity',
        });
        videoHeaders(response);
        const probeRange = response.status === 206 ? rangeFor(response) : null;
        if (probeRange && probeRange.start !== 0)
          videoError('Джерело повернуло не той початковий діапазон.');
        const total = probeRange?.total ?? Number(response.headers.get('content-length'));
        if (!Number.isSafeInteger(total) || total <= 0)
          videoError('Джерело не повідомило коректний розмір відео.');
        const validator = validatorFor(response);
        await response.body?.cancel();
        response = undefined;
        const previous = await videoState(metadata);
        const same =
          previous &&
          validator !== null &&
          previous.validator === validator &&
          previous.identity === source.identity &&
          previous.total === total;
        if (
          same &&
          previous.complete &&
          previous.bytes === total &&
          (await matchesState(target, previous))
        ) {
          return { file: target, bytes: total, status: 'already_downloaded' as const, metadata };
        }
        let offset =
          same &&
          !previous.complete &&
          previous.bytes < total &&
          (await matchesState(part, previous))
            ? previous.bytes
            : 0;
        options.onProgress?.(offset, total);
        const free = options.availableBytes
          ? await options.availableBytes(dirname(target))
          : await statfs(dirname(target)).then(info => info.bavail * info.bsize);
        if (free < total - offset + 16_777_216)
          throw new ClientError('DISK_FULL', 'Недостатньо вільного місця для відео.', 5);
        const headers: Record<string, string> = { ...publicHeaders, 'Accept-Encoding': 'identity' };
        if (offset && validator) {
          headers.Range = `bytes=${String(offset)}-`;
          headers['If-Range'] = validator;
        }
        response = await request(source.url, headers);
        videoHeaders(response);
        if (validatorFor(response) !== validator)
          videoError('Відеофайл змінився між запитами. Повтори команду.');
        if (response.status === 206) {
          const range = rangeFor(response);
          if (range.start !== offset || range.end !== total - 1 || range.total !== total)
            videoError('Content-Range не відповідає локальній частині відео.');
        } else {
          // If-Range can legitimately return the entire representation; never append it.
          offset = 0;
          if (free < total + 16_777_216)
            throw new ClientError('DISK_FULL', 'Недостатньо місця для повторного завантаження.', 5);
        }
        const length = Number(response.headers.get('content-length'));
        if (!Number.isSafeInteger(length) || length !== total - offset)
          videoError('Розмір відповіді не відповідає очікуваному відео.');
        state = {
          version: 1,
          identity: source.identity,
          total,
          validator,
          bytes: offset,
          sha256: createHash('sha256').digest('hex'),
          complete: false,
        };
        // Invalidate old checkpoint before opening/truncating the part. SIGKILL causes safe restart.
        await writeLocalFile(metadata, JSON.stringify(state));
        writing = true;
        let received = offset;
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            touch();
            received += chunk.length;
            if (received > total) {
              callback(
                new ClientError('DOWNLOAD_INVALID', 'Відео перевищило заявлений розмір.', 5),
              );
              return;
            }
            options.onProgress?.(received, total);
            callback(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(response.body ?? videoError('Джерело не віддало потік відео.')),
          meter,
          createWriteStream(part, { flags: offset ? 'a' : 'w' }),
          { signal: requestSignal },
        );
        if (received !== total) videoError('Відео завантажилося не повністю.');
        const file = await open(part, 'r');
        try {
          const prefix = Buffer.alloc(12);
          await file.read(prefix, 0, 12, 0);
          if (prefix.toString('ascii', 4, 8) !== 'ftyp') videoError('Файл не має сигнатури MP4.');
        } finally {
          await file.close();
        }
        assertActive();
        const digest = await fileDigest(part);
        state = { ...state, ...digest, complete: true };
        assertActive();
        await rename(part, target);
        writing = false;
        await writeLocalFile(metadata, JSON.stringify(state));
        return { file: target, bytes: total, status: 'downloaded' as const, metadata };
      } catch (error) {
        if (writing && state && !ownership.signal.aborted) {
          if (error instanceof ClientError && error.code === 'DOWNLOAD_INVALID') {
            await rm(part, { force: true });
            await rm(metadata, { force: true });
          } else {
            try {
              await writeLocalFile(
                metadata,
                JSON.stringify({ ...state, ...(await fileDigest(part)) }),
              );
            } catch {
              /* Missing checkpoint means the next run starts from zero. */
            }
          }
        }
        assertActive();
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC')
          throw new ClientError('DISK_FULL', 'Диск заповнився під час завантаження.', 5);
        if (error instanceof ClientError && error.code !== 'DOWNLOAD_UNAVAILABLE') throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
        if (response?.body && !response.body.locked)
          await response.body.cancel().catch(() => undefined);
      }
    }
    if (lastError instanceof ClientError) throw lastError;
    throw new ClientError(
      'DOWNLOAD_FAILED',
      'Не вдалося завантажити відео після обмежених повторів.',
      5,
    );
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('FILE_IO', 'Не вдалося відкрити або записати відеофайл.');
  } finally {
    if (release && !ownership.signal.aborted) await release().catch(() => undefined);
  }
}
