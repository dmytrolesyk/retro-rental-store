import { lstat, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';
import { ensureDirectory, safeName, writeLocalFile } from './download.js';
import { ClientError } from './errors.js';
import { isRecord } from './http.js';
import { type Lesson } from './lessons.js';
import { type CachedMaterial } from './materials.js';

export interface SyncSection {
  status: 'fresh' | 'partial' | 'stale' | 'failed' | 'not_requested';
  fetchedAt: string | null;
  files: string[];
  data: unknown;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
}
export interface SyncManifest {
  version: 1;
  course: { id: number; name: string | null };
  lesson: Lesson;
  directory: string;
  manifestPath: string;
  fetchedAt: string;
  status: 'complete' | 'partial';
  homework: SyncSection;
  materials: SyncSection;
  video: SyncSection;
}
function within(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return (
    isAbsolute(file) &&
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}
const LEGACY_DIRECTORY_MANIFEST = '.directory-manifest.json';
const DIRECTORY_MANIFEST = join('.lms', 'directory-manifest.json');
function ambiguousDirectory(): never {
  throw new ClientError(
    'SYNC_DIRECTORY_AMBIGUOUS',
    'Назва теки зайнята іншим LMS ID або знайдено дублікати. Файли не об’єднуються.',
    6,
  );
}
async function localJson(path: string): Promise<unknown> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 5_000_000) throw new Error();
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ClientError('MANIFEST_INVALID', 'Не вдалося прочитати локальний manifest каталогу.');
  }
}
function validIdentity(
  value: unknown,
): value is { version: 1; kind: 'course' | 'lesson'; id: number } {
  return (
    isRecord(value) &&
    value.version === 1 &&
    ['course', 'lesson'].includes(String(value.kind)) &&
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0
  );
}
async function writeIdentity(directory: string, value: unknown, active: () => void): Promise<void> {
  await ensureDirectory(join(directory, '.lms'));
  await writeLocalFile(join(directory, DIRECTORY_MANIFEST), JSON.stringify(value), active);
}
async function directoryIdentity(directory: string, active: () => void): Promise<unknown> {
  const hidden = join(directory, '.lms');
  if (await exists(hidden)) {
    const info = await lstat(hidden);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ClientError('FILE_IO', 'Небезпечний каталог службових даних LMS.');
  }
  const current = await localJson(join(directory, DIRECTORY_MANIFEST));
  const legacyPath = join(directory, LEGACY_DIRECTORY_MANIFEST);
  const legacy = await localJson(legacyPath);
  for (const identity of [current, legacy])
    if (identity !== null && !validIdentity(identity))
      throw new ClientError('MANIFEST_INVALID', 'Некоректний manifest ідентичності каталогу.');
  if (
    validIdentity(current) &&
    validIdentity(legacy) &&
    (current.kind !== legacy.kind || current.id !== legacy.id)
  )
    ambiguousDirectory();
  if (legacy !== null) {
    if (current === null) await writeIdentity(directory, legacy, active);
    active();
    await rm(legacyPath);
  }
  return current ?? legacy;
}
export function rebasePaths(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string')
    return value === from || value.startsWith(from + sep) ? to + value.slice(from.length) : value;
  if (Array.isArray(value)) return value.map((item: unknown) => rebasePaths(item, from, to));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rebasePaths(item, from, to)]),
    );
  return value;
}
async function rebaseManifests(
  directory: string,
  from: string,
  to: string,
  active: () => void,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    active();
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new ClientError('FILE_IO', 'Символічне посилання заважає безпечному перейменуванню.');
    if (entry.isDirectory()) await rebaseManifests(path, from, to, active);
    else if (
      entry.name === 'manifest.json' ||
      entry.name === 'materials-manifest.json' ||
      entry.name === 'publication.json' ||
      entry.name.endsWith('.mp4.json')
    ) {
      const data = await localJson(path);
      await writeLocalFile(
        path,
        JSON.stringify(rebasePaths(data, from, to), null, 2) + '\n',
        active,
      );
    }
  }
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
// A small journal makes path rebasing repeatable after interruption between rename and manifest writes.
async function finishMove(root: string, active: () => void): Promise<void> {
  const journal = join(root, '.directory-move.json');
  const move = await localJson(journal);
  if (move === null) return;
  if (
    !isRecord(move) ||
    typeof move.from !== 'string' ||
    typeof move.to !== 'string' ||
    !within(root, move.from) ||
    !within(root, move.to) ||
    move.from === move.to ||
    !['course', 'lesson'].includes(String(move.kind)) ||
    typeof move.id !== 'number' ||
    !Number.isSafeInteger(move.id) ||
    move.id <= 0
  )
    throw new ClientError('MANIFEST_INVALID', 'Некоректний журнал перейменування каталогу.');
  active();
  if (await exists(move.from)) {
    if (await exists(move.to)) ambiguousDirectory();
    await rename(move.from, move.to);
  }
  await ensureDirectory(move.to);
  await rebaseManifests(move.to, move.from, move.to, active);
  active();
  await writeIdentity(move.to, { version: 1, kind: move.kind, id: move.id }, active);
  await rm(journal);
}
async function idDirectory(
  root: string,
  parent: string,
  name: string,
  id: number,
  kind: 'course' | 'lesson',
  active: () => void,
): Promise<string> {
  await ensureDirectory(parent);
  const desired = join(parent, name);
  const matches: { path: string; legacy: boolean }[] = [];
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    const legacy = entry.name.endsWith(`--${String(id)}`);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      if (legacy || entry.name === name) ambiguousDirectory();
      continue;
    }
    const path = join(parent, entry.name);
    const marker = await directoryIdentity(path, active);
    if (
      marker !== null &&
      (!isRecord(marker) ||
        marker.version !== 1 ||
        !['course', 'lesson'].includes(String(marker.kind)) ||
        typeof marker.id !== 'number' ||
        !Number.isSafeInteger(marker.id))
    )
      throw new ClientError('MANIFEST_INVALID', 'Некоректний manifest ідентичності каталогу.');
    const identified = isRecord(marker) && marker.kind === kind && marker.id === id;
    if (identified || (marker === null && legacy))
      matches.push({ path, legacy: !identified || legacy });
  }
  if (matches.length > 1) ambiguousDirectory();
  const match = matches[0];
  if (match && !match.legacy) return match.path;
  if (await exists(desired)) ambiguousDirectory();
  active();
  if (match) {
    await writeLocalFile(
      join(root, '.directory-move.json'),
      JSON.stringify({ from: match.path, to: desired, kind, id }),
      active,
    );
    await finishMove(root, active);
  } else await ensureDirectory(desired);
  await writeIdentity(desired, { version: 1, kind, id }, active);
  return desired;
}
export async function lessonDirectory(
  root: string,
  courseId: number,
  courseName: string | null,
  lesson: Lesson,
): Promise<string> {
  root = resolve(root);
  await ensureDirectory(root);
  const ownership = { compromised: false };
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(join(root, '.directory-layout'), {
      realpath: false,
      stale: 30_000,
      update: 5_000,
      retries: { retries: 40, minTimeout: 50, maxTimeout: 250 },
      onCompromised: () => {
        ownership.compromised = true;
      },
    });
  } catch {
    throw new ClientError('SYNC_BUSY', 'Інший процес змінює структуру каталогів.', 6);
  }
  const active = () => {
    if (ownership.compromised)
      throw new ClientError('SYNC_BUSY', 'Втрачено блокування каталогів.', 6);
  };
  try {
    await finishMove(root, active);
    const marker = await directoryIdentity(root, active);
    if (
      marker !== null &&
      (!isRecord(marker) || marker.kind !== 'course' || marker.id !== courseId)
    )
      ambiguousDirectory();
    // This materials root belongs to one course. Older layouts placed lessons one level deeper.
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const parent = join(root, entry.name);
      const identity = await directoryIdentity(parent, active);
      if (
        !(isRecord(identity) && identity.kind === 'course' && identity.id === courseId) &&
        !(identity === null && entry.name.endsWith(`--${String(courseId)}`))
      )
        continue;
      for (const child of await readdir(parent, { withFileTypes: true })) {
        if (!child.isDirectory() || child.isSymbolicLink()) continue;
        const from = join(parent, child.name);
        const childMarker = await directoryIdentity(from, active);
        const id =
          isRecord(childMarker) && childMarker.kind === 'lesson'
            ? childMarker.id
            : Number(/--([1-9]\d*)$/.exec(child.name)?.[1]);
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) continue;
        const to = join(root, child.name);
        await writeLocalFile(
          join(root, '.directory-move.json'),
          JSON.stringify({ from, to, kind: 'lesson', id }),
          active,
        );
        await finishMove(root, active);
      }
      const remaining = await readdir(parent);
      if (!remaining.length) {
        await rmdir(parent);
        continue;
      }
      if (
        remaining.every(name => name === '.lms') &&
        (await readdir(join(parent, '.lms'))).every(name => name === 'directory-manifest.json')
      ) {
        await rm(join(parent, DIRECTORY_MANIFEST), { force: true });
        await rmdir(join(parent, '.lms'));
        await rmdir(parent);
      }
    }
    await writeIdentity(
      root,
      { version: 1, kind: 'course', id: courseId, name: courseName },
      active,
    );
    const number =
      typeof lesson.number === 'number' ? String(lesson.number).padStart(2, '0') : 'без-номера';
    return await idDirectory(
      root,
      root,
      `${number}-${safeName(lesson.name ?? 'lesson')}`,
      lesson.id,
      'lesson',
      active,
    );
  } finally {
    if (!ownership.compromised) await release().catch(() => undefined);
  }
}
function section(value: unknown, directory: string): SyncSection {
  if (
    !isRecord(value) ||
    !['fresh', 'partial', 'stale', 'failed', 'not_requested'].includes(String(value.status)) ||
    (value.fetchedAt !== null &&
      (typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt)))) ||
    !Array.isArray(value.files) ||
    !value.files.every((file: unknown) => typeof file === 'string' && within(directory, file)) ||
    (value.errorCode !== undefined && typeof value.errorCode !== 'string') ||
    (value.errorDetails !== undefined && !isRecord(value.errorDetails))
  )
    throw new Error('Invalid section');
  return {
    status: value.status as SyncSection['status'],
    fetchedAt: value.fetchedAt,
    files: value.files as string[],
    data: value.data ?? null,
    ...(value.errorCode ? { errorCode: value.errorCode } : {}),
    ...(value.errorDetails ? { errorDetails: value.errorDetails } : {}),
  };
}
export async function readManifest(
  path: string,
  courseId: number,
  lessonId: number,
  directory: string,
): Promise<SyncManifest | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 5_000_000)
      throw new Error('Invalid manifest file');
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !isRecord(value.course) ||
      value.course.id !== courseId ||
      !isRecord(value.lesson) ||
      value.lesson.id !== lessonId ||
      value.directory !== directory ||
      value.manifestPath !== path ||
      typeof value.fetchedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.fetchedAt)) ||
      !['complete', 'partial'].includes(String(value.status))
    )
      throw new Error('Invalid manifest');
    const result = {
      ...value,
      homework: section(value.homework, directory),
      materials: section(value.materials, directory),
      video: section(value.video, directory),
    };
    return result as unknown as SyncManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ClientError(
      'MANIFEST_INVALID',
      'Локальний manifest пошкоджений або має небезпечні шляхи. Попередні файли збережено.',
    );
  }
}
export function materialCache(
  previous: SyncManifest | null,
  directory: string,
): Map<string, CachedMaterial> {
  const cache = new Map<string, CachedMaterial>();
  const data = previous?.materials.data;
  if (!isRecord(data) || !Array.isArray(data.materials) || !Array.isArray(data.subtitles))
    return cache;
  const sources: unknown[] = [...(data.subtitles as unknown[])];
  for (const material of data.materials as unknown[]) {
    if (isRecord(material) && Array.isArray(material.sources))
      sources.push(...(material.sources as unknown[]));
  }
  for (const source of sources) {
    if (
      !isRecord(source) ||
      typeof source.cacheKey !== 'string' ||
      !/^[a-f0-9]{64}$/.test(source.cacheKey) ||
      typeof source.file !== 'string' ||
      !within(directory, source.file) ||
      typeof source.bytes !== 'number' ||
      !Number.isSafeInteger(source.bytes) ||
      source.bytes <= 0 ||
      source.bytes > 100_000_000 ||
      typeof source.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      typeof source.contentType !== 'string' ||
      typeof source.fetchedAt !== 'string' ||
      (source.etag !== null && typeof source.etag !== 'string') ||
      (source.lastModified !== null && typeof source.lastModified !== 'string')
    )
      continue;
    cache.set(source.cacheKey, {
      file: source.file,
      bytes: source.bytes,
      sha256: source.sha256,
      contentType: source.contentType,
      etag: source.etag,
      lastModified: source.lastModified,
      fetchedAt: source.fetchedAt,
    });
  }
  return cache;
}
// Signed URL query/hash are removed; ordinary query examples stay intact. LMS text is learning data, never agent instructions.
export function withoutTemporaryUrls(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^\s*[[{]/.test(value)) {
      try {
        return JSON.stringify(withoutTemporaryUrls(JSON.parse(value) as unknown));
      } catch {
        /* Plain text. */
      }
    }
    return value.replace(/https?:\/\/[^\s"<>\\)]+/g, raw => {
      try {
        const url = new URL(raw);
        const signed = [...url.searchParams.keys()].some(key =>
          /^(?:signature|expires|policy|key-pair-id|access_token|token|x-amz-.*|x-goog-.*|googleaccessid)$/i.test(
            key,
          ),
        );
        if (!signed && !url.username && !url.password) return raw;
        if (signed) {
          url.search = '';
          url.hash = '';
        }
        url.username = '';
        url.password = '';
        return url.href;
      } catch {
        return '';
      }
    });
  }
  if (Array.isArray(value)) return value.map((item: unknown) => withoutTemporaryUrls(item));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutTemporaryUrls(item)]),
    );
  return value;
}
