import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ensureDirectory, safeName } from './download.js';
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
// Reuse the folder for an ID after a rename; ambiguous manual duplicates require repair.
async function idDirectory(parent: string, name: string, id: number): Promise<string> {
  await ensureDirectory(parent);
  const entries = (await readdir(parent, { withFileTypes: true })).filter(entry =>
    entry.name.endsWith(`--${String(id)}`),
  );
  if (entries.some(entry => !entry.isDirectory() || entry.isSymbolicLink()) || entries.length > 1)
    throw new ClientError(
      'SYNC_DIRECTORY_AMBIGUOUS',
      'Кілька або небезпечна тека з тим самим LMS ID. Перевір course-materials.',
      6,
    );
  const directory = join(parent, entries[0]?.name ?? `${safeName(name)}--${String(id)}`);
  await ensureDirectory(directory);
  return directory;
}
export async function lessonDirectory(
  root: string,
  courseId: number,
  courseName: string | null,
  lesson: Lesson,
): Promise<string> {
  const course = await idDirectory(resolve(root), courseName ?? 'course', courseId);
  return idDirectory(course, lesson.name ?? 'lesson', lesson.id);
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
