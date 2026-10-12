import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MATERIALS_ROOT } from './config.js';
import { ClientError } from './errors.js';
import {
  type GraphqlReader,
  invalidResponse,
  nextCursor,
  nodes,
  nullableString,
  record,
  ukrainianTranslation,
} from './graphql.js';
import { convertDescription } from './homework.js';
import { type Lesson } from './lessons.js';
import {
  downloadFile,
  ensureDirectory,
  writeLocalFile,
  type FileKind,
  type CachedFile,
  validCachedFile,
} from './download.js';
import { lessonDirectory } from './manifest.js';
import { migrateLibrary } from './migrate-library.js';
import { arrangeMaterials } from './library.js';
import { vttToText } from './transcripts.js';
import { MATERIAL_COURSE, MATERIAL_SUBTITLES, MATERIAL_TYPES, MATERIALS } from './queries.js';

type SourceKind = 'drive' | 'slides' | 'file' | 'vtt' | 'external' | 'unsupported';
export interface Source {
  url: string;
  cacheKey: string;
  kind: SourceKind;
  role: 'material' | 'transcript';
  status:
    | 'not_downloaded'
    | 'link'
    | 'unsupported'
    | 'downloaded'
    | 'unavailable'
    | 'failed'
    | 'unchanged'
    | 'stale';
  file: string | null;
  textFile?: string;
  bytes?: number;
  contentType?: string;
  errorCode?: string;
  etag?: string | null;
  lastModified?: string | null;
  sha256?: string;
  fetchedAt?: string;
}
interface Candidate {
  source: Source;
  downloadUrl: string;
  fileKind: FileKind;
  key: string;
}
interface Material {
  id: number;
  iri: string;
  relationId: string;
  position: number | null;
  type: number;
  typeName: string | null;
  name: string | null;
  translationStatus: 'available' | 'missing';
  descriptionRaw: string | null;
  html: string | null;
  markdown: string | null;
  warnings: string[];
  sources: Source[];
}
export interface CachedMaterial extends CachedFile {
  fetchedAt: string;
}
interface MaterialOptions {
  download?: boolean;
  root?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  directory?: string;
  cache?: ReadonlyMap<string, CachedMaterial>;
  attempts?: number;
  referenceDirectory?: string;
}

function stableUrl(url: URL): string {
  const copy = new URL(url);
  copy.search = '';
  copy.hash = '';
  copy.username = '';
  copy.password = '';
  return copy.href;
}
function safeDescription(text: string): string {
  // Decode structured descriptions before removing URL queries, including escaped slashes.
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.replace(/https?:\/\/[^\s"<>\\]+/g, raw => {
        try {
          return stableUrl(new URL(raw));
        } catch {
          return '';
        }
      });
    if (Array.isArray(value)) return value.map((item: unknown) => scrub(item));
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]: [string, unknown]) => [key, scrub(item)]),
      );
    return value;
  };
  if (/^\s*[[{]/.test(text)) {
    try {
      return JSON.stringify(scrub(JSON.parse(text) as unknown));
    } catch {
      invalidResponse();
    }
  }
  return scrub(text) as string;
}
function sourceFor(
  raw: string,
  name: string | null,
  key: string,
  forceVtt = false,
): Candidate | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  let kind: SourceKind = 'external',
    downloadUrl = url.href,
    fileKind: FileKind = 'file';
  const transcript = forceVtt || /транскрип|transcript|субтитр/i.test(name ?? '');
  const driveId =
    url.hostname === 'drive.google.com'
      ? (/^\/file\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id'))
      : null;
  const slidesId =
    url.hostname === 'docs.google.com'
      ? /^\/presentation\/d\/([\w-]+)/.exec(url.pathname)?.[1]
      : undefined;
  if (url.protocol !== 'https:') kind = 'unsupported';
  else if (forceVtt || /\.vtt$/i.test(url.pathname)) {
    kind = 'vtt';
    fileKind = 'vtt';
  } else if (driveId && /^[\w-]+$/.test(driveId)) {
    kind = 'drive';
    fileKind = transcript ? 'text' : 'file';
    downloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download`;
    url = new URL(`https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`);
  } else if (slidesId) {
    kind = 'slides';
    fileKind = 'pdf';
    downloadUrl = `https://docs.google.com/presentation/d/${slidesId}/export/pdf`;
  } else if (url.hostname === 'github.com' || url.hostname.endsWith('.github.com')) {
    kind = 'external';
  } else if (/\.(pdf|md|txt|zip|docx|pptx)$/i.test(url.pathname)) {
    kind = 'file';
    fileKind = /\.pdf$/i.test(url.pathname)
      ? 'pdf'
      : /\.(md|txt)$/i.test(url.pathname)
        ? 'text'
        : 'file';
  } else if (['drive.google.com', 'docs.google.com'].includes(url.hostname)) kind = 'unsupported';
  const source: Source = {
    url: stableUrl(url),
    cacheKey: createHash('sha256').update(`${fileKind}:${downloadUrl}`).digest('hex'),
    kind,
    role: transcript || kind === 'vtt' ? 'transcript' : 'material',
    status:
      kind === 'external' ? 'link' : kind === 'unsupported' ? 'unsupported' : 'not_downloaded',
    file: null,
  };
  return { source, downloadUrl, fileKind, key };
}
function descriptionLinks(raw: string | null): string[] {
  if (!raw) return [];
  const links: string[] = [];
  if (/^\s*\[/.test(raw)) {
    let blocks: unknown;
    try {
      blocks = JSON.parse(raw) as unknown;
    } catch {
      invalidResponse();
    }
    if (!Array.isArray(blocks)) invalidResponse();
    for (const value of blocks) {
      const block = record(value);
      if (block.type === 'file') {
        const content = record(block.content);
        if (typeof content.src !== 'string') invalidResponse();
        links.push(content.src);
      } else if (block.type === 'text' && typeof block.content === 'string') {
        for (const match of block.content.matchAll(/href\s*=\s*["']([^"']+)["']/gi))
          if (match[1]) links.push(match[1].replace(/&amp;/g, '&'));
      }
    }
  } else
    for (const match of raw.matchAll(/href\s*=\s*["']([^"']+)["']/gi))
      if (match[1]) links.push(match[1].replace(/&amp;/g, '&'));
  return links;
}
async function typeNames(client: GraphqlReader): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const cursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const data = await client.query(MATERIAL_TYPES, { after });
    for (const node of nodes(data.lessonMaterialTypes)) {
      if (
        typeof node._id !== 'number' ||
        !Number.isSafeInteger(node._id) ||
        typeof node.name !== 'string' ||
        result.has(node._id)
      )
        invalidResponse();
      result.set(node._id, node.name);
    }
    after = nextCursor(data.lessonMaterialTypes);
    if (!after) return result;
    if (cursors.has(after)) invalidResponse();
    cursors.add(after);
  }
  invalidResponse();
}
export async function getMaterials(
  client: GraphqlReader,
  course: number,
  lesson: Lesson,
  options: MaterialOptions = {},
) {
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new ClientError('CANCELLED', 'Завантаження скасовано.', 130);
  };
  checkCancelled();
  const names = await typeNames(client);
  const courseData = await client.query(MATERIAL_COURSE, { id: `/api/courses/${String(course)}` });
  const courseTranslation = nodes(record(courseData.course).translations)[0];
  const courseName = courseTranslation ? nullableString(courseTranslation.name) : null;
  const materials: Material[] = [],
    subtitles: Source[] = [],
    candidates: Candidate[] = [];
  const relationIds = new Set<string>();
  let total: number | undefined;
  for (let page = 1; page <= 1000; page++) {
    const data = await client.query(MATERIALS, { lesson: lesson.iri, page });
    const connection = record(data.lessonMaterialHasLessons),
      info = record(connection.paginationInfo);
    if (
      !Array.isArray(connection.collection) ||
      typeof info.totalCount !== 'number' ||
      !Number.isSafeInteger(info.totalCount) ||
      info.totalCount < 0 ||
      typeof info.hasNextPage !== 'boolean'
    )
      invalidResponse();
    total ??= info.totalCount;
    if (info.totalCount !== total || (info.hasNextPage && !connection.collection.length))
      invalidResponse();
    for (const value of connection.collection) {
      const relation = record(value),
        node = record(relation.lessonMaterial);
      const match =
        typeof node.id === 'string' ? /^\/api\/lesson_materials\/([1-9]\d*)$/.exec(node.id) : null;
      if (
        !match?.[1] ||
        !Number.isSafeInteger(Number(match[1])) ||
        typeof relation.id !== 'string' ||
        relationIds.has(relation.id)
      )
        invalidResponse();
      if (typeof node.type !== 'number' || !Number.isSafeInteger(node.type)) invalidResponse();
      const position = relation.position;
      if (
        position !== null &&
        (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0)
      )
        invalidResponse();
      relationIds.add(relation.id);
      const id = Number(match[1]),
        translation = ukrainianTranslation(node.translations);
      const name = translation ? nullableString(translation.name) : null;
      const description = translation ? nullableString(translation.description) : null;
      const link = translation ? nullableString(translation.link) : null;
      const sources: Source[] = [],
        seen = new Set<string>();
      const add = (raw: string, forceVtt = false) => {
        const candidate = sourceFor(
          raw,
          name,
          `material-${String(id)}-${String(sources.length + 1)}`,
          forceVtt,
        );
        if (!candidate || seen.has(candidate.source.url)) return;
        seen.add(candidate.source.url);
        sources.push(candidate.source);
        candidates.push(candidate);
      };
      if (link) add(link);
      for (const item of descriptionLinks(description)) add(item);
      if (node.subtitle !== null) {
        const subtitle = record(node.subtitle);
        if (typeof subtitle.contentUrl !== 'string') invalidResponse();
        add(subtitle.contentUrl, true);
      }
      materials.push({
        id,
        iri: node.id as string,
        relationId: relation.id,
        position,
        type: node.type,
        typeName: names.get(node.type) ?? null,
        name,
        translationStatus: translation ? 'available' : 'missing',
        ...(description === null
          ? { descriptionRaw: null, html: null, markdown: null, warnings: [] }
          : convertDescription(safeDescription(description))),
        sources,
      });
    }
    if (materials.length > total) invalidResponse();
    if (!info.hasNextPage) {
      if (materials.length !== total) invalidResponse();
      break;
    }
    if (page === 1000) invalidResponse();
  }
  materials.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.id - b.id);
  let after: string | null = null;
  const cursors = new Set<string>(),
    mediaIds = new Set<string>();
  for (let page = 0; page < 1000; page++) {
    const data = await client.query(MATERIAL_SUBTITLES, { id: lesson.iri, after });
    const result = record(data.lesson);
    if (result.id !== lesson.iri) invalidResponse();
    for (const node of nodes(result.medias)) {
      if (
        typeof node.id !== 'string' ||
        !/^\/api\/lesson_media\/[1-9]\d*$/.test(node.id) ||
        mediaIds.has(node.id)
      )
        invalidResponse();
      mediaIds.add(node.id);
      if (node.subtitle === null) continue;
      const subtitle = record(node.subtitle);
      if (typeof subtitle.contentUrl !== 'string') invalidResponse();
      const candidate = sourceFor(
        subtitle.contentUrl,
        null,
        `subtitle-${node.id.split('/').at(-1) ?? ''}`,
        true,
      );
      if (candidate) {
        subtitles.push(candidate.source);
        candidates.push(candidate);
      }
    }
    after = nextCursor(result.medias);
    if (!after) break;
    if (cursors.has(after) || page === 999) invalidResponse();
    cursors.add(after);
  }
  let directory: string | null = null,
    manifestPath: string | null = null;
  if (options.download) {
    checkCancelled();
    directory =
      options.directory ??
      (await lessonDirectory(options.root ?? MATERIALS_ROOT, course, courseName, lesson));
    if (!options.directory) await migrateLibrary(directory, course, lesson.id);
    const downloads = join(directory, '.lms', 'downloads');
    await ensureDirectory(downloads);
    candidates.sort(
      (a, b) =>
        Number(a.source.role === 'transcript' && a.fileKind === 'vtt') -
        Number(b.source.role === 'transcript' && b.fileKind === 'vtt'),
    );
    for (const candidate of candidates) {
      checkCancelled();
      if (candidate.source.status !== 'not_downloaded') continue;
      if (
        candidate.source.role === 'transcript' &&
        candidates.some(
          other =>
            other !== candidate &&
            other.source.role === 'transcript' &&
            ['downloaded', 'unchanged'].includes(other.source.status),
        )
      )
        continue;
      const extension =
        candidate.fileKind === 'pdf'
          ? '.pdf'
          : candidate.fileKind === 'vtt'
            ? '.vtt'
            : candidate.fileKind === 'text'
              ? '.md'
              : '.bin';
      const target = join(downloads, candidate.key + extension);
      const cache = options.cache?.get(candidate.source.cacheKey);
      try {
        let transcriptText: string | undefined;
        const load = () =>
          downloadFile(candidate.downloadUrl, target, {
            kind: candidate.fileKind,
            fetchImpl: options.fetchImpl,
            signal: options.signal,
            cache:
              candidate.fileKind === 'vtt' && cache?.contentType !== 'text/vtt' ? undefined : cache,
            referer: candidate.fileKind === 'vtt' ? 'https://lms.robotdreams.cc/' : undefined,
            validateFile:
              candidate.fileKind === 'vtt'
                ? async temporary => {
                    transcriptText = vttToText(await readFile(temporary, 'utf8'));
                  }
                : undefined,
          });
        let downloaded: Awaited<ReturnType<typeof downloadFile>> | undefined;
        for (let attempt = 0; attempt < Math.min(options.attempts ?? 1, 2); attempt++) {
          try {
            downloaded = await load();
            break;
          } catch (error) {
            checkCancelled();
            if (
              attempt + 1 >= Math.min(options.attempts ?? 1, 2) ||
              !(error instanceof ClientError) ||
              !['DOWNLOAD_FAILED', 'DOWNLOAD_UNAVAILABLE'].includes(error.code)
            )
              throw error;
          }
        }
        if (!downloaded)
          throw new ClientError('DOWNLOAD_FAILED', 'Не вдалося завантажити матеріал.', 5);
        if (downloaded.status === 'unchanged' && candidate.fileKind === 'vtt')
          transcriptText = vttToText(await readFile(downloaded.file, 'utf8'));
        if (transcriptText !== undefined) {
          const textFile = join(downloads, candidate.key + '.txt');
          await writeLocalFile(textFile, transcriptText);
          candidate.source.textFile = textFile;
        }
        Object.assign(candidate.source, downloaded, { fetchedAt: new Date().toISOString() });
      } catch (error) {
        if (options.signal?.aborted)
          throw new ClientError('CANCELLED', 'Завантаження скасовано.', 130);
        candidate.source.status =
          error instanceof ClientError && error.code === 'DOWNLOAD_UNAVAILABLE'
            ? 'unavailable'
            : 'failed';
        candidate.source.errorCode = error instanceof ClientError ? error.code : 'DOWNLOAD_FAILED';
        if (cache && (await validCachedFile(cache))) {
          Object.assign(candidate.source, cache, { status: 'stale' });
          if (candidate.fileKind === 'vtt') {
            try {
              const textFile = join(downloads, candidate.key + '.txt');
              await writeLocalFile(textFile, vttToText(await readFile(cache.file, 'utf8')));
              candidate.source.textFile = textFile;
            } catch {
              /* The verified original VTT is still available. */
            }
          }
        }
      }
    }
    manifestPath = join(directory, '.lms', 'materials-manifest.json');
  }
  const transcriptSources = candidates
    .filter(c => c.source.role === 'transcript')
    .map(c => c.source);
  const transcriptStatus = !transcriptSources.length
    ? 'missing'
    : transcriptSources.some(s => s.status === 'downloaded' || s.status === 'unchanged')
      ? 'available'
      : transcriptSources.some(s => s.status === 'stale')
        ? 'stale'
        : options.download
          ? 'unavailable'
          : 'not_downloaded';
  const result = {
    version: 1,
    courseId: course,
    courseName,
    lesson,
    materials,
    subtitles,
    transcriptStatus,
    directory,
    manifestPath,
    fetchedAt: new Date().toISOString(),
  };
  checkCancelled();
  if (manifestPath && directory) {
    await arrangeMaterials(result, directory, options.referenceDirectory);
    checkCancelled();
    await writeLocalFile(manifestPath, JSON.stringify(result, null, 2) + '\n');
    await rm(join(directory, '.lms', 'downloads'), { recursive: true, force: true });
  }
  return result;
}
