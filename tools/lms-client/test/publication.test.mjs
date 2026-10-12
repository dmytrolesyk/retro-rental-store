import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  realpath,
  readFile,
  writeFile,
  rm,
  readdir,
  mkdir,
  access,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStage, publishLesson, recoverPublication } from '../dist/publication.js';
import { migrateLibrary } from '../dist/migrate-library.js';
async function temp(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lms-publication-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('publication recovers after one file was moved and removes only managed obsolete files', async t => {
  const dir = await temp(t),
    stage = await createStage(dir);
  await writeFile(join(dir, 'homework.md'), 'New task');
  await writeFile(join(stage, 'presentation.pdf'), '%PDF new');
  await mkdir(join(stage, '.lms'));
  await writeFile(join(stage, '.lms', 'manifest.json'), '{}');
  await mkdir(join(dir, 'snapshots', 'old'), { recursive: true });
  const obsolete = join(dir, 'snapshots', 'old', 'old.pdf'),
    personal = join(dir, 'snapshots', 'old', 'my-notes.md');
  await writeFile(obsolete, 'old');
  await writeFile(personal, 'Notes');
  const moves = ['homework.md', 'presentation.pdf', '.lms/manifest.json'].map(name => ({
    from: join(stage, name),
    to: join(dir, name),
  }));
  await writeFile(
    join(dir, '.lms', 'publication.json'),
    JSON.stringify({ stage, moves, obsolete: [obsolete] }),
  );
  await recoverPublication(dir);
  await recoverPublication(dir);
  assert.equal(await readFile(join(dir, 'presentation.pdf'), 'utf8'), '%PDF new');
  assert.equal(await readFile(personal, 'utf8'), 'Notes');
  await assert.rejects(access(stage), { code: 'ENOENT' });
  await assert.rejects(access(obsolete), { code: 'ENOENT' });
});
test('publication refuses to overwrite a file not owned by the manifest', async t => {
  const dir = await temp(t),
    stage = await createStage(dir);
  await writeFile(join(dir, 'presentation.pdf'), 'Personal file');
  await writeFile(join(stage, 'presentation.pdf'), 'Downloaded');
  await assert.rejects(publishLesson(dir, stage, []), { code: 'FILE_IO' });
  assert.equal(await readFile(join(dir, 'presentation.pdf'), 'utf8'), 'Personal file');
});
test('offline legacy migration keeps video inode and exports one transcript without snapshots', async t => {
  const dir = await temp(t),
    snapshot = join(dir, 'snapshots', 'one');
  await mkdir(snapshot, { recursive: true });
  const pdf = join(snapshot, 'material-1.pdf'),
    md = join(snapshot, 'material-2.md'),
    vtt = join(snapshot, 'sub.vtt'),
    txt = join(snapshot, 'sub.txt'),
    hw = join(snapshot, 'homework.md'),
    video = join(dir, 'video-10-1080p.mp4');
  for (const [file, text] of [
    [pdf, '%PDF'],
    [md, 'Transcript'],
    [vtt, 'WEBVTT'],
    [txt, 'Extra text'],
    [hw, 'Task'],
    [video, 'Video'],
    [video + '.json', '{"complete":true}'],
  ])
    await writeFile(file, text);
  const before = await stat(video);
  const section = (files, data) => ({
    status: 'fresh',
    fetchedAt: '2026-10-12T12:00:00Z',
    files,
    data,
  });
  const source = (file, kind, role = 'material') => ({
    file,
    kind,
    role,
    status: 'downloaded',
    url: 'https://example.test/file',
  });
  const materials = {
    directory: snapshot,
    manifestPath: join(snapshot, 'materials-manifest.json'),
    materials: [
      { name: 'Slides', sources: [source(pdf, 'slides')] },
      { name: 'Transcript', sources: [source(md, 'drive', 'transcript')] },
    ],
    subtitles: [{ ...source(vtt, 'vtt', 'transcript'), textFile: txt }],
  };
  await writeFile(materials.manifestPath, JSON.stringify(materials));
  const manifest = {
    version: 1,
    course: { id: 1, name: 'Course' },
    lesson: { id: 20 },
    directory: dir,
    manifestPath: join(dir, 'manifest.json'),
    fetchedAt: '2026-10-12T12:00:00Z',
    status: 'complete',
    homework: section([hw], {}),
    materials: section([pdf, md, vtt, txt], materials),
    video: section([video, video + '.json'], {
      file: video,
      metadata: video + '.json',
      quality: 1080,
    }),
  };
  await writeFile(manifest.manifestPath, JSON.stringify(manifest));
  await migrateLibrary(dir, 1, 20);
  await migrateLibrary(dir, 1, 20);
  assert.equal((await stat(join(dir, 'lecture.mp4'))).ino, before.ino);
  assert.equal(await readFile(join(dir, 'transcript.md'), 'utf8'), 'Transcript');
  assert.deepEqual(
    (await readdir(dir)).sort(),
    [
      '.lms',
      'additional-materials.md',
      'homework.md',
      'lecture.mp4',
      'presentation.pdf',
      'transcript.md',
    ].sort(),
  );
  const migrated = JSON.parse(await readFile(join(dir, '.lms', 'manifest.json'), 'utf8'));
  assert.equal(migrated.materials.data.subtitles[0].file, null);
  for (const file of [
    ...migrated.homework.files,
    ...migrated.materials.files,
    ...migrated.video.files,
  ])
    await access(file);
});
