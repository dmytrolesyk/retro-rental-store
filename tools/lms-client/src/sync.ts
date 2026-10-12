import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import { MATERIALS_ROOT } from './config.js';
import { ensureDirectory, writeLocalFile } from './download.js';
import { ClientError } from './errors.js';
import { type GraphqlReader, nodes, nullableString, record } from './graphql.js';
import { getHomework } from './homework.js';
import { type Lesson } from './lessons.js';
import { getMaterials } from './materials.js';
import {
  lessonDirectory,
  materialCache,
  readManifest,
  withoutTemporaryUrls,
  type SyncManifest,
  type SyncSection,
} from './manifest.js';
import { MATERIAL_COURSE } from './queries.js';
import { getVideo } from './video.js';

interface SyncOptions {
  root?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  video?: boolean;
  quality?: number;
  mediaId?: number;
  onProgress?: (bytes: number, total: number) => void;
}
function errorCode(error: unknown): string {
  return error instanceof ClientError ? error.code : 'SYNC_FAILED';
}
export async function syncLesson(
  client: GraphqlReader,
  courseId: number,
  lesson: Lesson,
  options: SyncOptions = {},
): Promise<SyncManifest> {
  const root = options.root ?? MATERIALS_ROOT;
  const ownership = new AbortController();
  const signal = AbortSignal.any([ownership.signal, ...(options.signal ? [options.signal] : [])]);
  const active = () => {
    if (ownership.signal.aborted)
      throw new ClientError('SYNC_BUSY', 'Втрачено блокування синхронізації.', 6);
    if (options.signal?.aborted)
      throw new ClientError(
        'CANCELLED',
        'Синхронізацію скасовано; попередній manifest збережено.',
        130,
      );
  };
  active();
  await ensureDirectory(join(root, '.sync-locks'));
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(
      join(root, '.sync-locks', `course-${String(courseId)}-lesson-${String(lesson.id)}`),
      {
        realpath: false,
        stale: 30_000,
        update: 5_000,
        retries: 0,
        onCompromised: () => {
          ownership.abort();
        },
      },
    );
  } catch {
    throw new ClientError('SYNC_BUSY', 'Цю лекцію вже синхронізує інший процес.', 6);
  }
  let snapshot: string | undefined;
  let committed = false;
  const reader: GraphqlReader = {
    async query(query, variables) {
      for (let attempt = 0; ; attempt++) {
        active();
        try {
          return await client.query(query, variables);
        } catch (error) {
          active();
          if (
            attempt >= 1 ||
            !(error instanceof ClientError) ||
            !['NETWORK_ERROR', 'HTTP_ERROR'].includes(error.code)
          )
            throw error;
        }
      }
    },
  };
  try {
    const course = await reader.query(MATERIAL_COURSE, { id: `/api/courses/${String(courseId)}` });
    const translation = nodes(record(course.course).translations)[0];
    const courseName = translation ? nullableString(translation.name) : null;
    active();
    const directory = await lessonDirectory(root, courseId, courseName, lesson);
    const manifestPath = join(directory, 'manifest.json');
    const previous = await readManifest(manifestPath, courseId, lesson.id, directory);
    snapshot = join(directory, 'snapshots', randomUUID());
    await ensureDirectory(snapshot);
    const now = () => new Date().toISOString();
    const failed = async (
      error: unknown,
      before: SyncSection | undefined,
    ): Promise<SyncSection> => {
      active();
      if (
        error instanceof ClientError &&
        ['AUTH_REQUIRED', 'SESSION_INVALID', 'AUTH_INTERACTION_REQUIRED'].includes(error.code)
      )
        throw error;
      const details = error instanceof ClientError ? error.details : undefined;
      if (before && before.fetchedAt) {
        let exists = true;
        for (const file of before.files) {
          try {
            await ensureDirectory(dirname(file));
            const info = await lstat(file);
            if (!info.isFile() || info.isSymbolicLink()) exists = false;
          } catch {
            exists = false;
          }
        }
        if (exists)
          return { ...before, status: 'stale', errorCode: errorCode(error), errorDetails: details };
      }
      return {
        status: 'failed',
        fetchedAt: null,
        files: [],
        data: null,
        errorCode: errorCode(error),
        errorDetails: details,
      };
    };
    let homework: SyncSection;
    try {
      const data = await getHomework(reader, courseId, lesson);
      const text = data.homeworks.length
        ? data.homeworks
            .map(
              item =>
                `## ${item.name ?? 'Домашнє завдання'}\n\nLMS ID: ${String(item.id)}\n\n${item.markdown ?? 'Український текст завдання відсутній.'}`,
            )
            .join('\n\n')
        : 'У цього уроку немає домашнього завдання.';
      active();
      const file = join(snapshot, 'homework.md');
      await writeLocalFile(
        file,
        String(
          withoutTemporaryUrls(
            `# ${lesson.name ?? 'Урок'}\n\nДжерело: ${lesson.url}\nОтримано: ${data.fetchedAt}\n\n${text}\n`,
          ),
        ),
      );
      homework = {
        status: data.homeworks.some(
          item => item.translationStatus === 'missing' || item.warnings.length,
        )
          ? 'partial'
          : 'fresh',
        fetchedAt: data.fetchedAt,
        files: [file],
        data,
      };
    } catch (error) {
      homework = await failed(error, previous?.homework);
    }
    let materials: SyncSection;
    try {
      const data = await getMaterials(reader, courseId, lesson, {
        download: true,
        root,
        directory: snapshot,
        fetchImpl: options.fetchImpl,
        signal,
        attempts: 2,
        cache: materialCache(previous, directory),
      });
      const sources = [...data.materials.flatMap(item => item.sources), ...data.subtitles];
      materials = {
        status: sources.some(source =>
          ['unavailable', 'failed', 'stale', 'unsupported'].includes(source.status),
        )
          ? 'partial'
          : 'fresh',
        fetchedAt: data.fetchedAt,
        files: [
          ...new Set(
            sources.flatMap(source =>
              [source.file, source.textFile].filter(
                (file): file is string => typeof file === 'string',
              ),
            ),
          ),
        ],
        data,
      };
    } catch (error) {
      materials = await failed(error, previous?.materials);
    }
    let video: SyncSection =
      previous?.video && previous.video.fetchedAt
        ? { ...previous.video, status: 'not_requested' }
        : { status: 'not_requested', fetchedAt: null, files: [], data: null };
    if (options.video) {
      try {
        active();
        const data = await getVideo(reader, courseId, lesson, {
          quality: options.quality ?? 1080,
          mediaId: options.mediaId,
          root,
          directory,
          fetchImpl: options.fetchImpl,
          signal,
          onProgress: options.onProgress,
        });
        video = {
          status: 'fresh',
          fetchedAt: data.fetchedAt,
          files: [data.file, data.metadata],
          data,
        };
      } catch (error) {
        video = await failed(error, previous?.video);
      }
    }
    active();
    const result: SyncManifest = {
      version: 1,
      course: { id: courseId, name: courseName },
      lesson,
      directory,
      manifestPath,
      fetchedAt: now(),
      status: [homework, materials, ...(options.video ? [video] : [])].some(
        part => part.status !== 'fresh',
      )
        ? 'partial'
        : 'complete',
      homework,
      materials,
      video,
    };
    // Publish one pointer only after every section has a result. Previous snapshots stay readable.
    await writeLocalFile(
      manifestPath,
      JSON.stringify(withoutTemporaryUrls(result), null, 2) + '\n',
      active,
    );
    committed = true;
    return withoutTemporaryUrls(result) as SyncManifest;
  } finally {
    if (snapshot && !committed)
      await rm(snapshot, { recursive: true, force: true }).catch(() => undefined);
    if (!ownership.signal.aborted) await release().catch(() => undefined);
  }
}
