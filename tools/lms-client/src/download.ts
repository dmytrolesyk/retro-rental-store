import { createWriteStream } from 'node:fs';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ClientError } from './errors.js';

export type FileKind = 'pdf' | 'text' | 'vtt' | 'file';
export interface DownloadOptions {
  kind: FileKind;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  validateFile?: (temporaryPath: string) => Promise<void>;
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
export async function writeLocalFile(target: string, text: string): Promise<void> {
  const temporary = `${target}.part-${randomUUID()}`;
  try {
    await checkTarget(target);
    await writeFile(temporary, text, { flag: 'wx' });
    await rename(temporary, target);
  } catch {
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
    let next = checkedUrl(url);
    for (let attempt = 0; attempt <= 5; attempt++) {
      response = await (options.fetchImpl ?? fetch)(next, { redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
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
    await rename(temporary, target);
    return { file: target, bytes, contentType };
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('DOWNLOAD_FAILED', 'Не вдалося завантажити файл повністю.', 5);
  } finally {
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}
