import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, readFile, rename, rm, realpath } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { ensureDirectory, safeName, writeLocalFile } from './download.js';
import { ClientError } from './errors.js';
import { type Source } from './materials.js';
import { vttToText } from './transcripts.js';

interface LibraryMaterials {
  materials: { name: string | null; sources: Source[] }[];
  subtitles: Source[];
  directory: string | null;
  manifestPath: string | null;
}
export async function copyAsset(from: string, to: string): Promise<void> {
  if (from === to) return;
  const info = await lstat(from);
  if (!info.isFile() || info.isSymbolicLink())
    throw new ClientError('FILE_IO', 'Матеріал має бути звичайним локальним файлом.');
  await ensureDirectory(resolve(to, '..'));
  const temporary = `${to}.${randomUUID()}.part`;
  try {
    await copyFile(from, temporary);
    await rename(temporary, to);
  } finally {
    await rm(temporary, { force: true });
  }
}
function cell(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
async function localReference(
  url: string,
  directory: string,
  referenceRoot?: string,
): Promise<{ path: string; text: string } | null> {
  const parsed = new URL(url);
  if (parsed.hostname !== 'github.com') return null;
  const match = /^\/robot-dreams-code\/NODE-JS-PRO-2\/blob\/main\/(.+)$/.exec(parsed.pathname);
  if (!match?.[1]) return null;
  const root = referenceRoot ?? resolve(import.meta.dirname, '../../../reference/node-js-pro');
  const path = resolve(root, decodeURIComponent(match[1]));
  if (!path.startsWith(root + sep) || extname(path) !== '.md') return null;
  try {
    if ((await realpath(path)) !== path) return null;
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1_000_000) return null;
    return {
      path: relative(directory, path).split(sep).map(encodeURIComponent).join('/'),
      text: await readFile(path, 'utf8'),
    };
  } catch {
    return null;
  }
}
export async function additionalMaterials(
  data: LibraryMaterials,
  directory: string,
  referenceRoot?: string,
): Promise<string> {
  const rows: string[] = [],
    seen = new Set<string>();
  const add = (name: string, url: string, local?: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return;
    const href = parsed.href.replaceAll('|', '%7C').replaceAll('(', '%28').replaceAll(')', '%29');
    rows.push(
      `| ${cell(name)} | [Відкрити](<${href}>)${local ? ` · [Локальна копія](<${local}>)` : ''} |`,
    );
  };
  for (const material of data.materials) {
    for (const source of material.sources) {
      if (source.role === 'transcript' || !['external', 'unsupported'].includes(source.kind))
        continue;
      const local = await localReference(source.url, directory, referenceRoot);
      add(material.name ?? 'Додатковий матеріал', source.url, local?.path);
      if (local && /(?:additional|додатков)/i.test(source.url + (material.name ?? ''))) {
        for (const match of local.text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g))
          if (match[1] && match[2]) add(match[1], match[2]);
      }
    }
  }
  return (
    '# Додаткові матеріали\n\n' +
    (rows.length
      ? '| Матеріал | Посилання |\n| --- | --- |\n' + rows.join('\n') + '\n'
      : 'Додаткових посилань у LMS немає.\n')
  );
}

/** Turn downloaded sources into one human-readable set; the source IDs remain in metadata. */
export async function arrangeMaterials(
  data: LibraryMaterials,
  directory: string,
  referenceDirectory = directory,
): Promise<string[]> {
  const files: string[] = [],
    used = new Set<string>();
  const all = [...data.materials.flatMap(m => m.sources), ...data.subtitles];
  const downloaded = (source: Source) =>
    source.file && ['downloaded', 'unchanged', 'stale'].includes(source.status);
  for (const material of data.materials) {
    for (const source of material.sources) {
      if (source.role === 'transcript' || !downloaded(source) || !source.file) continue;
      const extension = extname(source.file);
      const title =
        source.kind === 'slides' || /презентац|presentation|slides/i.test(material.name ?? '')
          ? 'presentation'
          : safeName(material.name ?? basename(source.url, extname(source.url)));
      let name = title + extension,
        counter = 2;
      while (used.has(name)) name = `${title}-${String(counter++)}${extension}`;
      used.add(name);
      const target = join(directory, name);
      await copyAsset(source.file, target);
      source.file = target;
      files.push(target);
    }
  }
  const transcripts = all.filter(source => source.role === 'transcript' && downloaded(source));
  transcripts.sort(
    (a, b) =>
      Number(a.status === 'stale') - Number(b.status === 'stale') ||
      Number(a.kind === 'vtt') - Number(b.kind === 'vtt'),
  );
  const selected = transcripts[0];
  if (selected?.file) {
    const original = await readFile(selected.file, 'utf8');
    const converted = selected.kind === 'vtt' && selected.contentType !== 'text/markdown';
    const text = converted ? vttToText(original) : original;
    const target = join(directory, 'transcript.md');
    await writeLocalFile(target, text);
    Object.assign(selected, {
      file: target,
      bytes: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'),
      contentType: 'text/markdown',
    });
    if (converted) Object.assign(selected, { etag: null, lastModified: null });
    delete selected.textFile;
    files.push(target);
  }
  for (const source of all) {
    if (source.role !== 'transcript' || source === selected) continue;
    source.file = null;
    delete source.textFile;
    if (['downloaded', 'unchanged', 'stale'].includes(source.status))
      source.status = 'not_downloaded';
  }
  const links = join(directory, 'additional-materials.md');
  await writeLocalFile(links, await additionalMaterials(data, referenceDirectory));
  files.push(links);
  data.directory = directory;
  data.manifestPath = join(directory, '.lms', 'materials-manifest.json');
  await ensureDirectory(join(directory, '.lms'));
  return files;
}

export function recordingFilename(
  recordings: { id: number; name: string | null }[],
  mediaId: number,
  quality: number,
): string {
  const suffix = quality === 1080 ? '' : `-${String(quality)}p`;
  if (recordings.length < 2) return `lecture${suffix}.mp4`;
  const index = recordings.findIndex(recording => recording.id === mediaId);
  return `lecture-${String(index + 1).padStart(2, '0')}-${safeName(recordings[index]?.name ?? 'recording')}${suffix}.mp4`;
}
