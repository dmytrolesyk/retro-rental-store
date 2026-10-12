import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lessonDirectory } from '../dist/manifest.js';
async function root(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lms-dirs-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const lesson = { id: 104320, number: 14, name: 'Transactions / SQL' };
test('folders omit LMS IDs and start with a sortable lecture number', async t => {
  const dir = await root(t);
  assert.equal(
    await lessonDirectory(dir, 5467, 'Node.js PRO', lesson),
    join(dir, '14-Transactions-SQL'),
  );
  assert.equal(
    await lessonDirectory(dir, 5467, 'Renamed course', { ...lesson, name: 'New title' }),
    join(dir, '14-Transactions-SQL'),
  );
  assert.equal(
    await lessonDirectory(dir, 5467, 'Node.js PRO', { id: 104307, number: 1, name: 'Runtime' }),
    join(dir, '01-Runtime'),
  );
});
test('migration keeps files and rebases nested manifests instead of downloading again', async t => {
  const dir = await root(t),
    oldCourse = join(dir, 'Node-js-PRO--5467'),
    old = join(oldCourse, 'Transactions-SQL--104320');
  await mkdir(join(old, 'snapshots', 'one'), { recursive: true });
  const asset = join(old, 'snapshots', 'one', 'homework.md');
  await writeFile(asset, 'Assignment');
  await writeFile(
    join(old, 'manifest.json'),
    JSON.stringify({
      directory: old,
      manifestPath: join(old, 'manifest.json'),
      homework: { files: [asset] },
      lesson: { id: 104320, number: 14 },
    }),
  );
  await writeFile(
    join(old, 'snapshots', 'one', 'materials-manifest.json'),
    JSON.stringify({ directory: join(old, 'snapshots', 'one'), file: asset }),
  );
  const actual = await lessonDirectory(dir, 5467, 'Node.js PRO', lesson);
  assert.equal(actual, join(dir, '14-Transactions-SQL'));
  assert.equal(
    await readFile(join(actual, 'snapshots', 'one', 'homework.md'), 'utf8'),
    'Assignment',
  );
  const data = JSON.parse(await readFile(join(actual, 'manifest.json'), 'utf8'));
  assert.equal(data.directory, actual);
  assert.equal(data.homework.files[0], join(actual, 'snapshots', 'one', 'homework.md'));
  assert.doesNotMatch(
    await readFile(join(actual, 'snapshots', 'one', 'materials-manifest.json'), 'utf8'),
    /--5467|--104320/,
  );
  await assert.rejects(access(oldCourse), { code: 'ENOENT' });
});
test('different IDs cannot overwrite an existing folder with the same display name', async t => {
  const dir = await root(t);
  await lessonDirectory(dir, 5467, 'Node', lesson);
  await assert.rejects(lessonDirectory(dir, 999, 'Node', lesson), {
    code: 'SYNC_DIRECTORY_AMBIGUOUS',
  });
});

test('interrupted move recovers manifests and folder identity on the next run', async t => {
  const dir = await root(t),
    from = join(dir, 'Node-js-PRO--5467'),
    to = join(dir, 'Node-js-PRO');
  await mkdir(join(to, 'Transactions-SQL--104320'), { recursive: true });
  await writeFile(
    join(to, 'Transactions-SQL--104320', 'manifest.json'),
    JSON.stringify({ directory: join(from, 'Transactions-SQL--104320') }),
  );
  await writeFile(
    join(dir, '.directory-move.json'),
    JSON.stringify({ from, to, kind: 'course', id: 5467 }),
  );
  const actual = await lessonDirectory(dir, 5467, 'Node.js PRO', lesson);
  assert.equal(actual, join(dir, '14-Transactions-SQL'));
  assert.equal(JSON.parse(await readFile(join(actual, 'manifest.json'), 'utf8')).directory, actual);
  await assert.rejects(access(join(dir, '.directory-move.json')), { code: 'ENOENT' });
});

test('already readable course directory is flattened without changing files', async t => {
  const dir = await root(t),
    oldCourse = join(dir, 'Node-js-PRO');
  const oldLesson = join(oldCourse, '14-Transactions-SQL');
  await mkdir(oldLesson, { recursive: true });
  await writeFile(
    join(oldCourse, '.directory-manifest.json'),
    JSON.stringify({ version: 1, kind: 'course', id: 5467 }),
  );
  await writeFile(
    join(oldLesson, '.directory-manifest.json'),
    JSON.stringify({ version: 1, kind: 'lesson', id: 104320 }),
  );
  await writeFile(join(oldLesson, 'lecture.mp4'), 'Existing video');
  const actual = await lessonDirectory(dir, 5467, 'Node.js PRO', lesson);
  assert.equal(actual, join(dir, '14-Transactions-SQL'));
  assert.equal(await readFile(join(actual, 'lecture.mp4'), 'utf8'), 'Existing video');
  await assert.rejects(access(oldCourse), { code: 'ENOENT' });
});

test('directory identity lives in .lms and existing root markers migrate idempotently', async t => {
  const dir = await root(t),
    existing = join(dir, '14-Transactions-SQL');
  await mkdir(existing, { recursive: true });
  const course = { version: 1, kind: 'course', id: 5467 },
    identity = { version: 1, kind: 'lesson', id: 104320 };
  await writeFile(join(dir, '.directory-manifest.json'), JSON.stringify(course));
  await writeFile(join(existing, '.directory-manifest.json'), JSON.stringify(identity));
  await writeFile(join(existing, 'lecture.mp4'), 'Existing video');
  assert.equal(await lessonDirectory(dir, 5467, 'Node.js PRO', lesson), existing);
  assert.equal(
    await lessonDirectory(dir, 5467, 'Node.js PRO', { ...lesson, name: 'Renamed' }),
    existing,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(existing, '.lms', 'directory-manifest.json'), 'utf8')),
    identity,
  );
  assert.equal(
    JSON.parse(await readFile(join(dir, '.lms', 'directory-manifest.json'), 'utf8')).id,
    5467,
  );
  for (const parent of [dir, existing])
    await assert.rejects(access(join(parent, '.directory-manifest.json')), { code: 'ENOENT' });
  assert.equal(await readFile(join(existing, 'lecture.mp4'), 'utf8'), 'Existing video');
});
test('conflicting old and new directory identities are rejected without deleting either', async t => {
  const dir = await root(t);
  await mkdir(join(dir, '.lms'));
  await writeFile(
    join(dir, '.directory-manifest.json'),
    JSON.stringify({ version: 1, kind: 'course', id: 5467 }),
  );
  await writeFile(
    join(dir, '.lms', 'directory-manifest.json'),
    JSON.stringify({ version: 1, kind: 'course', id: 999 }),
  );
  await assert.rejects(lessonDirectory(dir, 5467, 'Node.js PRO', lesson), {
    code: 'SYNC_DIRECTORY_AMBIGUOUS',
  });
  await access(join(dir, '.directory-manifest.json'));
  await access(join(dir, '.lms', 'directory-manifest.json'));
});
