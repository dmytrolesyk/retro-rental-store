import { rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { arrangeMaterials, copyAsset } from './library.js';
import { readManifest, rebasePaths, type SyncManifest } from './manifest.js';
import { isRecord } from './http.js';
import { writeLocalFile } from './download.js';
import { createStage, publishLesson, recoverPublication } from './publication.js';

export function managedFiles(manifest: SyncManifest | null): string[] {
  if (!manifest) return [];
  const files = [
    ...manifest.homework.files,
    ...manifest.materials.files,
    ...manifest.video.files,
    manifest.manifestPath,
  ];
  if (
    isRecord(manifest.materials.data) &&
    typeof manifest.materials.data.manifestPath === 'string' &&
    manifest.materials.data.manifestPath.startsWith(manifest.directory + '/')
  )
    files.push(manifest.materials.data.manifestPath);
  return [...new Set(files)];
}
/** Offline upgrade: only the files identified by the old manifest are moved or removed. */
export async function migrateLibrary(
  directory: string,
  courseId: number,
  lessonId: number,
): Promise<void> {
  await recoverPublication(directory);
  const previous = await readManifest(
    join(directory, 'manifest.json'),
    courseId,
    lessonId,
    directory,
  );
  if (!previous) return;
  const stage = await createStage(directory);
  try {
    const result = structuredClone(previous);
    result.manifestPath = join(directory, '.lms', 'manifest.json');
    if (previous.homework.files[0]) {
      const file = join(stage, 'homework.md');
      await copyAsset(previous.homework.files[0], file);
      result.homework.files = [file];
    }
    const materials = result.materials.data;
    if (
      isRecord(materials) &&
      Array.isArray(materials.materials) &&
      Array.isArray(materials.subtitles)
    ) {
      // readManifest validates the top-level managed paths; nested source paths must also be managed.
      const known = new Set(previous.materials.files);
      const sources: unknown[] = [...(materials.subtitles as unknown[])];
      for (const item of materials.materials as unknown[])
        if (isRecord(item) && Array.isArray(item.sources))
          sources.push(...(item.sources as unknown[]));
      for (const source of sources)
        if (isRecord(source) && typeof source.file === 'string' && !known.has(source.file))
          source.file = null;
      const data = materials as unknown as Parameters<typeof arrangeMaterials>[0];
      result.materials.files = await arrangeMaterials(data, stage, directory);
      await writeLocalFile(
        join(stage, '.lms', 'materials-manifest.json'),
        JSON.stringify(data, null, 2) + '\n',
      );
    }
    const moves: { from: string; to: string }[] = [];
    const video = result.video.data;
    if (
      isRecord(video) &&
      typeof video.file === 'string' &&
      previous.video.files.includes(video.file)
    ) {
      const name = video.quality === 1080 ? 'lecture.mp4' : `lecture-${String(video.quality)}p.mp4`;
      const target = join(directory, name),
        metadata = join(directory, '.lms', name + '.json');
      if (video.file !== target) moves.push({ from: video.file, to: target });
      const oldMetadata = video.metadata;
      if (
        typeof oldMetadata === 'string' &&
        previous.video.files.includes(oldMetadata) &&
        oldMetadata !== metadata
      )
        moves.push({ from: oldMetadata, to: metadata });
      video.file = target;
      video.metadata = metadata;
      result.video.files = [target, metadata];
    }
    const rebased = rebasePaths(result, stage, directory) as SyncManifest;
    await writeLocalFile(
      join(stage, '.lms', 'manifest.json'),
      JSON.stringify(rebased, null, 2) + '\n',
    );
    // Rebase the standalone materials manifest too.
    if (rebased.materials.data)
      await writeLocalFile(
        join(stage, '.lms', 'materials-manifest.json'),
        JSON.stringify(rebased.materials.data, null, 2) + '\n',
      );
    await publishLesson(directory, stage, managedFiles(previous), moves, [
      ...rebased.homework.files,
      ...rebased.materials.files,
      ...rebased.video.files,
    ]);
  } finally {
    const pending = await access(join(directory, '.lms', 'publication.json')).then(
      () => true,
      () => false,
    );
    if (!pending) await rm(stage, { recursive: true, force: true });
  }
}
