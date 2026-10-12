import { join, resolve } from 'node:path';
import { MATERIALS_ROOT } from './config.js';
import { downloadVideo, safeName, type VideoSource } from './download.js';
import { ClientError } from './errors.js';
import {
  type GraphqlReader,
  invalidResponse,
  nextCursor,
  nodes,
  nullableString,
  record,
} from './graphql.js';
import { type Lesson } from './lessons.js';
import { MATERIAL_COURSE, VIDEO_MEDIAS, VIDEO_RESOLUTIONS } from './queries.js';

interface Recording {
  id: number;
  name: string | null;
  qualities: number[];
}
interface Resolution {
  id: number;
  quality: number;
  durationSeconds: number | null;
  url: string;
}
interface VideoOptions {
  quality: number;
  mediaId?: number;
  root?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (bytes: number, total: number) => void;
}
function iriId(value: unknown, resource: string): number {
  if (typeof value !== 'string') invalidResponse();
  const match = new RegExp(`^/api/${resource}/([1-9]\\d*)$`).exec(value);
  const id = Number(match?.[1]);
  if (!Number.isSafeInteger(id) || id <= 0) invalidResponse();
  return id;
}
async function connectionPages(
  load: (after: string | null) => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const connection = await load(after);
    result.push(...nodes(connection));
    after = nextCursor(connection);
    if (after === null) return result;
    if (seen.has(after)) invalidResponse();
    seen.add(after);
  }
  return invalidResponse();
}
async function resolutions(client: GraphqlReader, mediaId: number): Promise<Resolution[]> {
  const values = await connectionPages(
    async after =>
      (
        await client.query(VIDEO_RESOLUTIONS, {
          media: `/api/lesson_media/${String(mediaId)}`,
          after,
        })
      ).lessonMediaResolutions,
  );
  const seen = new Set<number>(),
    qualities = new Set<number>();
  return values.map(value => {
    const id = iriId(value.id, 'lesson_media_resolutions');
    if (
      seen.has(id) ||
      typeof value.type !== 'number' ||
      !Number.isSafeInteger(value.type) ||
      value.type <= 0 ||
      qualities.has(value.type) ||
      typeof value.link !== 'string' ||
      !value.link ||
      (value.durationInSeconds !== null &&
        (typeof value.durationInSeconds !== 'number' ||
          !Number.isFinite(value.durationInSeconds) ||
          value.durationInSeconds < 0))
    )
      invalidResponse();
    seen.add(id);
    qualities.add(value.type);
    return {
      id,
      quality: value.type,
      durationSeconds: value.durationInSeconds,
      url: value.link,
    };
  });
}
export function selectRecording(
  recordings: Recording[],
  options: Pick<VideoOptions, 'mediaId' | 'quality'>,
): Recording {
  const details = { recordings };
  if (!recordings.length)
    throw new ClientError('VIDEO_NOT_FOUND', 'Урок не має доступних записів.', 5, details);
  if (options.mediaId === undefined && recordings.length > 1)
    throw new ClientError(
      'VIDEO_SELECTION_REQUIRED',
      'Урок має кілька записів. Вибери --media-id; перелік є в error.details.recordings.',
      2,
      details,
    );
  const selected =
    options.mediaId === undefined
      ? recordings[0]
      : recordings.find(item => item.id === options.mediaId);
  if (!selected)
    throw new ClientError(
      'VIDEO_NOT_FOUND',
      'Цей media ID не належить записам вибраного уроку.',
      2,
      details,
    );
  if (!selected.qualities.includes(options.quality))
    throw new ClientError(
      'VIDEO_QUALITY_UNAVAILABLE',
      'Вибрана якість відсутня. Доступні якості є в error.details.recordings; вибери --quality явно.',
      2,
      details,
    );
  return selected;
}
export async function getVideo(
  client: GraphqlReader,
  courseId: number,
  lesson: Lesson,
  options: VideoOptions,
) {
  const medias = await connectionPages(async after => {
    const data = await client.query(VIDEO_MEDIAS, { id: lesson.iri, after });
    const node = record(data.lesson);
    if (node.id !== lesson.iri) invalidResponse();
    return node.medias;
  });
  const recordings: Recording[] = [],
    seen = new Set<number>();
  for (const media of medias) {
    const id = iriId(media.id, 'lesson_media');
    if (seen.has(id)) invalidResponse();
    seen.add(id);
    recordings.push({
      id,
      name: nullableString(media.name),
      qualities: (await resolutions(client, id)).map(item => item.quality).sort((a, b) => a - b),
    });
  }
  const selected = selectRecording(recordings, options);
  const course = await client.query(MATERIAL_COURSE, { id: `/api/courses/${String(courseId)}` });
  const translations = nodes(record(course.course).translations);
  const courseName = translations[0] ? nullableString(translations[0].name) : null;
  const directory = join(
    resolve(options.root ?? MATERIALS_ROOT),
    `${safeName(courseName ?? 'course')}--${String(courseId)}`,
    `${safeName(lesson.name ?? 'lesson')}--${String(lesson.id)}`,
  );
  const file = join(directory, `video-${String(selected.id)}-${String(options.quality)}p.mp4`);
  let resolutionId: number | undefined;
  const freshSource = async (): Promise<VideoSource> => {
    if (options.signal?.aborted) throw new ClientError('CANCELLED', 'Завантаження скасовано.', 130);
    const fresh = (await resolutions(client, selected.id)).find(
      item => item.quality === options.quality,
    );
    if (!fresh || (resolutionId !== undefined && fresh.id !== resolutionId))
      throw new ClientError('VIDEO_CHANGED', 'Вибраний запис змінився в LMS. Повтори команду.', 5);
    resolutionId = fresh.id;
    return {
      url: fresh.url,
      referer: 'https://lms.robotdreams.cc/',
      identity: `/api/lesson_media_resolutions/${String(fresh.id)}`,
    };
  };
  const download = await downloadVideo(freshSource, file, options);
  return {
    courseId,
    lesson,
    recordings,
    mediaId: selected.id,
    resolutionId,
    quality: options.quality,
    directory,
    ...download,
    fetchedAt: new Date().toISOString(),
  };
}
