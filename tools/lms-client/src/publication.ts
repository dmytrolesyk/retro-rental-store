import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ensureDirectory, writeLocalFile } from './download.js';
import { ClientError } from './errors.js';
import { isRecord } from './http.js';

interface Move {
  from: string;
  to: string;
}
interface Publication {
  stage: string;
  moves: Move[];
  obsolete: string[];
  retained?: string[];
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    isAbsolute(path) &&
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}
async function regular(path: string): Promise<boolean> {
  await ensureDirectory(dirname(path));
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new ClientError('FILE_IO', 'Оновлення зупинено: небезпечний шлях до файлу.');
  }
}
async function emptyDirectories(path: string): Promise<void> {
  try {
    for (const entry of await readdir(path, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await emptyDirectories(join(path, entry.name));
    await rmdir(path);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error;
  }
}
export async function createStage(directory: string): Promise<string> {
  const stage = join(directory, '.lms', `update-${randomUUID()}`);
  await ensureDirectory(stage);
  return stage;
}
export async function recoverPublication(directory: string): Promise<void> {
  const journal = join(directory, '.lms', 'publication.json');
  if (!(await regular(journal))) return;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(journal, 'utf8')) as unknown;
  } catch {
    value = null;
  }
  if (
    !isRecord(value) ||
    typeof value.stage !== 'string' ||
    !value.stage.startsWith(join(directory, '.lms', 'update-')) ||
    !inside(directory, value.stage) ||
    !Array.isArray(value.moves) ||
    !Array.isArray(value.obsolete) ||
    !value.moves.every(
      m =>
        isRecord(m) &&
        typeof m.from === 'string' &&
        typeof m.to === 'string' &&
        inside(directory, m.from) &&
        inside(directory, m.to) &&
        m.from !== m.to,
    ) ||
    !value.obsolete.every(p => typeof p === 'string' && inside(directory, p))
  )
    throw new ClientError('MANIFEST_INVALID', 'Некоректний журнал оновлення матеріалів.');
  if (
    value.retained !== undefined &&
    (!Array.isArray(value.retained) ||
      !value.retained.every(p => typeof p === 'string' && inside(directory, p)))
  )
    throw new ClientError('MANIFEST_INVALID', 'Некоректний перелік збережених файлів.');
  const publication = value as unknown as Publication;
  // Roll forward idempotently. Readers call recovery before opening the published manifest.
  for (const move of publication.moves) {
    if (await regular(move.from)) {
      await regular(move.to);
      await rename(move.from, move.to);
    } else if (!(await regular(move.to))) {
      throw new ClientError('FILE_IO', 'Не вдалося відновити перерване оновлення матеріалів.');
    }
  }
  const current = new Set([
    ...publication.moves.map(move => move.to),
    ...(publication.retained ?? []),
  ]);
  for (const file of publication.obsolete)
    if (!current.has(file) && (await regular(file))) await rm(file);
  await rm(publication.stage, { recursive: true, force: true });
  await emptyDirectories(join(directory, 'snapshots'));
  await rm(journal);
}
async function stagedFiles(stage: string, directory = stage): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new ClientError('FILE_IO', 'Символічне посилання у тимчасових матеріалах.');
    if (entry.isDirectory()) files.push(...(await stagedFiles(stage, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
export async function publishLesson(
  directory: string,
  stage: string,
  obsolete: string[],
  extra: Move[] = [],
  retained: string[] = [],
): Promise<void> {
  const files = await stagedFiles(stage);
  const moves = [
    ...extra,
    ...files.map(from => ({ from, to: join(directory, relative(stage, from)) })),
  ];
  const manifestPath = join(directory, '.lms', 'manifest.json');
  moves.sort((a, b) => Number(a.to === manifestPath) - Number(b.to === manifestPath));
  const allowed = new Set([
    ...obsolete,
    join(directory, '.lms', 'materials-manifest.json'),
    manifestPath,
  ]);
  for (const move of moves) {
    if (!inside(directory, move.from) || !inside(directory, move.to))
      throw new ClientError('FILE_IO', 'Файл виходить за межі каталогу лекції.');
    if ((await regular(move.to)) && !allowed.has(move.to))
      throw new ClientError('FILE_IO', 'Назва нового матеріалу зайнята стороннім файлом.');
  }
  await writeLocalFile(
    join(directory, '.lms', 'publication.json'),
    JSON.stringify({ stage, moves, obsolete, retained }),
  );
  await recoverPublication(directory);
}
