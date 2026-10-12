import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm, realpath, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
async function temp(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lms-library-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('readable files choose one transcript and preserve separate presentations', async t => {
  const { arrangeMaterials } = await import('../dist/library.js');
  const dir = await temp(t);
  const pdf = join(dir, 'raw.pdf'),
    drive = join(dir, 'drive.md'),
    vtt = join(dir, 'raw.vtt');
  await writeFile(pdf, '%PDF fixture');
  await writeFile(drive, '# Готовий текст');
  await writeFile(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nСубтитри\n');
  const source = (file, kind, role = 'material') => ({
    file,
    kind,
    role,
    status: 'downloaded',
    url: 'https://example.test/file',
  });
  const data = {
    materials: [
      { name: 'Презентація', sources: [source(pdf, 'slides')] },
      { name: 'Друга презентація', sources: [source(pdf, 'slides')] },
      { name: 'Транскрипція', sources: [source(drive, 'drive', 'transcript')] },
    ],
    subtitles: [source(vtt, 'vtt', 'transcript')],
  };
  const files = await arrangeMaterials(data, dir);
  assert.ok(files.includes(join(dir, 'presentation.pdf')));
  assert.ok(files.includes(join(dir, 'presentation-2.pdf')));
  assert.equal(await readFile(join(dir, 'transcript.md'), 'utf8'), '# Готовий текст');
  assert.equal(data.subtitles[0].file, null);
  assert.equal(data.materials[2].sources[0].file, join(dir, 'transcript.md'));
});
test('VTT fallback produces one Markdown transcript with timestamps and matching hash', async t => {
  const { arrangeMaterials } = await import('../dist/library.js');
  const { createHash } = await import('node:crypto');
  const dir = await temp(t),
    raw = join(dir, 'raw.vtt');
  await writeFile(raw, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nПривіт\n');
  const source = {
    file: raw,
    kind: 'vtt',
    role: 'transcript',
    status: 'downloaded',
    url: 'https://example.test/sub.vtt',
  };
  await arrangeMaterials({ materials: [], subtitles: [source] }, dir);
  const content = await readFile(source.file, 'utf8');
  assert.match(content, /\[00:00:01.000\] Привіт/);
  assert.equal(source.sha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(source.etag, null);
});
test('additional links are escaped, deduplicated and include lecturer additional.md sources', async t => {
  const { additionalMaterials } = await import('../dist/library.js');
  const dir = await temp(t),
    reference = join(dir, 'reference');
  await mkdir(join(reference, 'lectures', '14_TransactionsSqlOpt'), { recursive: true });
  await writeFile(
    join(reference, 'lectures', '14_TransactionsSqlOpt', 'additional.md'),
    '[Transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html)',
  );
  const result = await additionalMaterials(
    {
      materials: [
        {
          name: 'A | B <script>',
          sources: [{ kind: 'external', role: 'material', url: 'https://example.test/a' }],
        },
        {
          name: 'Duplicate',
          sources: [{ kind: 'external', role: 'material', url: 'https://example.test/a' }],
        },
        {
          name: 'Додаткові матеріали',
          sources: [
            {
              kind: 'external',
              role: 'material',
              url: 'https://github.com/robot-dreams-code/NODE-JS-PRO-2/blob/main/lectures/14_TransactionsSqlOpt/additional.md',
            },
          ],
        },
      ],
      subtitles: [],
    },
    dir,
    reference,
  );
  assert.match(result, /A \\\| B &lt;script&gt;/);
  assert.equal(result.split('https://example.test/a').length, 2);
  assert.match(result, /Локальна копія/);
  assert.match(result, /transaction-iso/);
});
