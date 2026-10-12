import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const connection = list => ({
  edges: list.map(node => ({ node })),
  pageInfo: { hasNextPage: false, endCursor: null },
});
const selected = {
  id: 104319,
  iri: '/api/lessons/104319',
  number: 13,
  name: '../TypeORM / урок',
  url: 'https://lms.robotdreams.cc/course/5467/lesson/104319',
};
const material = (id, name, link, type = 0, description = '[]') => ({
  id: `/api/lesson_material_has_lessons/${id}-104319`,
  position: id,
  lessonMaterial: {
    id: `/api/lesson_materials/${id}`,
    type,
    translations: connection([{ locale: 'uk', empty: false, name, description, link }]),
    subtitle: null,
  },
});
function reader(items, media = []) {
  return {
    calls: [],
    async query(query, variables) {
      this.calls.push({ query, variables });
      if (query.includes('MaterialTypes'))
        return {
          lessonMaterialTypes: connection([
            { _id: 0, name: 'link' },
            { _id: 2, name: 'file' },
          ]),
        };
      if (query.includes('MaterialCourse'))
        return { course: { translations: connection([{ name: 'Node.js PRO' }]) } };
      if (query.includes('MaterialSubtitles'))
        return { lesson: { id: selected.iri, medias: connection(media) } };
      return {
        lessonMaterialHasLessons: {
          collection: items.slice((variables.page - 1) * 2, variables.page * 2),
          paginationInfo: {
            totalCount: items.length,
            hasNextPage: variables.page * 2 < items.length,
          },
        },
      };
    },
  };
}
async function temp(t) {
  const p = await mkdtemp(join(tmpdir(), 'lms-materials-'));
  t.after(() => rm(p, { recursive: true, force: true }));
  return realpath(p);
}

test('materials paginates and extracts links from structured blocks without leaking signed URLs', async () => {
  const { getMaterials } = await import('../dist/materials.js');
  const r = reader([
    material(1, 'Slides', 'https://docs.google.com/presentation/d/slide-id/edit', 2),
    material(2, 'Links', 'https://github.com/robot-dreams-code/course/blob/main/additional.md', 0),
    material(3, 'Транскрипція', 'https://drive.google.com/file/d/drive-id/view?usp=sharing', 0),
    material(
      4,
      'Attachment',
      null,
      2,
      JSON.stringify([
        { type: 'file', content: { src: 'https://cdn.example.test/a.pdf?Signature=secret' } },
      ]).replaceAll('/', '\\/'),
    ),
  ]);
  const result = await getMaterials(r, 5467, selected);
  assert.equal(result.materials.length, 4);
  assert.equal(r.calls.filter(c => c.query.includes('ClientMaterials')).length, 2);
  assert.equal(result.materials[0].sources[0].kind, 'slides');
  assert.equal(result.materials[1].sources[0].status, 'link');
  assert.equal(result.materials[2].sources[0].role, 'transcript');
  assert.equal(result.materials[3].sources[0].url, 'https://cdn.example.test/a.pdf');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(result.directory, null);
});

test('downloads PDF and Drive Markdown, retains external links, writes a manifest and survives unavailable VTT', async t => {
  const { getMaterials } = await import('../dist/materials.js');
  const root = await temp(t);
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers?.authorization, undefined);
    if (String(url).includes('drive.usercontent'))
      return new Response('# Лекція\n\n**[00:01]** Привіт', {
        headers: { 'content-type': 'application/octet-stream' },
      });
    if (String(url).includes('/export/pdf'))
      return new Response('%PDF-1.4\ncontent', { headers: { 'content-type': 'application/pdf' } });
    return new Response('Access denied', { status: 403 });
  };
  const r = reader(
    [
      material(1, 'Slides', 'https://docs.google.com/presentation/d/slide-id/edit', 2),
      material(2, 'Транскрипція', 'https://drive.google.com/file/d/drive-id/view'),
      material(3, 'GitHub', 'https://github.com/example/repo'),
    ],
    [
      {
        id: '/api/lesson_media/140777',
        subtitle: { contentUrl: 'https://cdn.example.test/sub.vtt?Signature=private' },
      },
    ],
  );
  const result = await getMaterials(r, 5467, selected, { download: true, root, fetchImpl });
  assert.ok(result.directory.startsWith(root + '/'));
  assert.ok(!result.directory.includes('../'));
  assert.equal(result.transcriptStatus, 'available');
  assert.match(await readFile(result.materials[1].sources[0].file, 'utf8'), /\*\*\[00:01\]\*\*/);
  assert.equal(result.subtitles[0].status, 'unavailable');
  assert.equal(result.materials[2].sources[0].status, 'link');
  assert.ok(urls.some(u => u.includes('export=download')));
  assert.ok(urls.some(u => u.includes('/export/pdf')));
  const saved = await readFile(result.manifestPath, 'utf8');
  assert.ok(!saved.includes('Signature=private'));
  assert.equal(JSON.parse(saved).materials.length, 3);
});

test('closed Drive and missing translations are explicit; no transcript is not reported as downloaded', async t => {
  const { getMaterials } = await import('../dist/materials.js');
  const root = await temp(t);
  const missing = material(2, null, null);
  missing.lessonMaterial.translations = connection([]);
  const r = reader([
    material(1, 'Транскрипція', 'https://drive.google.com/file/d/closed/view'),
    missing,
  ]);
  const result = await getMaterials(r, 5467, selected, {
    download: true,
    root,
    fetchImpl: async () =>
      new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(result.transcriptStatus, 'unavailable');
  assert.equal(result.materials[0].sources[0].status, 'unavailable');
  assert.equal(result.materials[1].translationStatus, 'missing');
  assert.equal((await getMaterials(reader([]), 5467, selected)).transcriptStatus, 'missing');
});

test('VTT preserves timing, removes exact duplicates and overlapping rolling text, keeps later repetitions', async () => {
  const { vttToText } = await import('../dist/transcripts.js');
  const vtt =
    'WEBVTT\n\nNOTE ignore\nanything\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Speaker>Привіт &amp; світ</v>\n\n2\n00:00:01.000 --> 00:00:03.000\nПривіт &amp; світ\n\n3\n00:00:02.000 --> 00:00:04.000\nПривіт &amp; світ сьогодні\n\n4\n00:00:06.000 --> 00:00:07.000\nПривіт &amp; світ\n';
  const text = vttToText(vtt);
  assert.equal((text.match(/Привіт & світ/g) || []).length, 2);
  assert.match(text, /\[00:00:02.000\] сьогодні/);
  assert.match(text, /\[00:00:06.000\]/);
  assert.throws(() => vttToText('<html>Login</html>'), { code: 'TRANSCRIPT_INVALID' });
  assert.throws(() => vttToText('WEBVTT\n\n00:00:xx --> 00:00:03.000\nBad'), {
    code: 'TRANSCRIPT_INVALID',
  });
});

test('download validates magic, length, limit and completion; failures keep old files and remove parts', async t => {
  const { downloadFile } = await import('../dist/download.js');
  const root = await temp(t);
  const dest = join(root, 'file.pdf');
  await writeFile(dest, 'old');
  for (const response of [
    () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'application/pdf' } }),
    () =>
      new Response('%PDF-short', {
        headers: { 'content-type': 'application/pdf', 'content-length': '999' },
      }),
    () => new Response('%PDF-too-large', { headers: { 'content-type': 'application/pdf' } }),
    () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('%PDF-'));
            c.error(new Error('private'));
          },
        }),
        { headers: { 'content-type': 'application/pdf' } },
      ),
  ]) {
    await assert.rejects(
      downloadFile('https://example.test/file', dest, {
        kind: 'pdf',
        maxBytes: 12,
        fetchImpl: async () => response(),
      }),
    );
    assert.equal(await readFile(dest, 'utf8'), 'old');
    assert.deepEqual(await readdir(root), ['file.pdf']);
  }
  await downloadFile('https://example.test/file', dest, {
    kind: 'pdf',
    fetchImpl: async () =>
      new Response('%PDF-1.4\nvalid', { headers: { 'content-type': 'application/pdf' } }),
  });
  assert.match(await readFile(dest, 'utf8'), /^%PDF-/);
});

test('safe names and symlink destinations cannot redirect downloads', async t => {
  const { safeName, downloadFile } = await import('../dist/download.js');
  const root = await temp(t);
  assert.ok(!safeName('../../ A/B\\C\u0000').includes('/'));
  assert.ok(!safeName('..').includes('..'));
  const target = join(root, 'target');
  await writeFile(target, 'original');
  await symlink(target, join(root, 'link'));
  await assert.rejects(
    downloadFile('https://example.test/a', join(root, 'link'), {
      kind: 'text',
      fetchImpl: async () => new Response('text'),
    }),
  );
  assert.equal(await readFile(target, 'utf8'), 'original');
});

test('VTT download keeps the original and creates timestamped text, malformed replacement preserves old VTT', async t => {
  const { getMaterials } = await import('../dist/materials.js');
  const root = await temp(t);
  const media = [
    {
      id: '/api/lesson_media/140777',
      subtitle: { contentUrl: 'https://cdn.example.test/a.vtt?Signature=hidden' },
    },
  ];
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nПривіт\n';
  const result = await getMaterials(reader([], media), 5467, selected, {
    download: true,
    root,
    fetchImpl: async () => new Response(vtt, { headers: { 'content-type': 'text/vtt' } }),
  });
  assert.equal(result.transcriptStatus, 'available');
  assert.equal(await readFile(result.subtitles[0].file, 'utf8'), vtt);
  assert.match(await readFile(result.subtitles[0].textFile, 'utf8'), /\[00:00:01.000\] Привіт/);
  const failed = await getMaterials(reader([], media), 5467, selected, {
    download: true,
    root,
    fetchImpl: async () =>
      new Response('WEBVTT\n\n00:bad --> 00:00:03.000\nBad', {
        headers: { 'content-type': 'text/vtt' },
      }),
  });
  assert.equal(failed.subtitles[0].status, 'failed');
  assert.equal(await readFile(result.subtitles[0].file, 'utf8'), vtt);
  assert.ok(!(await readdir(result.directory)).some(name => name.includes('.part-')));
});

test('timeout and cancellation stop stalled streams and do not leave partial files', async t => {
  const { downloadFile } = await import('../dist/download.js');
  const root = await temp(t);
  const fetchImpl = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
        },
      }),
      { headers: { 'content-type': 'text/plain' } },
    );
  await assert.rejects(
    downloadFile('https://example.test/stalled', join(root, 'text.md'), {
      kind: 'text',
      timeoutMs: 30,
      fetchImpl,
    }),
    { code: 'DOWNLOAD_FAILED' },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    downloadFile('https://example.test/stalled', join(root, 'text.md'), {
      kind: 'text',
      signal: controller.signal,
      fetchImpl,
    }),
    { code: 'DOWNLOAD_FAILED' },
  );
  assert.deepEqual(await readdir(root), []);
});

test('redirects remain HTTPS, have a bound, and cannot turn a login page into a file', async t => {
  const { downloadFile } = await import('../dist/download.js');
  const root = await temp(t);
  for (const location of [
    'http://example.test/file',
    'https://accounts.google.com/login',
    'https://example.test/again',
  ]) {
    let count = 0;
    await assert.rejects(
      downloadFile('https://example.test/file', join(root, 'file.pdf'), {
        kind: 'pdf',
        fetchImpl: async () => {
          count++;
          return new Response(null, { status: 302, headers: { location } });
        },
      }),
    );
    assert.ok(count <= 6);
    assert.deepEqual(await readdir(root), []);
  }
});

test('cancelled material download returns CANCELLED without a success manifest', async t => {
  const { getMaterials } = await import('../dist/materials.js');
  const root = await temp(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    getMaterials(reader([]), 5467, selected, { download: true, root, signal: controller.signal }),
    { code: 'CANCELLED' },
  );
  assert.deepEqual(await readdir(root), []);
});

test('unsupported sources remain explicit links and are never fetched', async t => {
  const { getMaterials } = await import('../dist/materials.js');
  const root = await temp(t);
  const result = await getMaterials(
    reader([
      material(1, 'Doc', 'https://docs.google.com/document/d/unsupported/edit'),
      material(2, 'HTTP', 'http://example.test/file.pdf'),
    ]),
    5467,
    selected,
    {
      download: true,
      root,
      fetchImpl: async () => {
        assert.fail('Unsupported source must not be fetched');
      },
    },
  );
  assert.equal(result.materials[0].sources[0].status, 'unsupported');
  assert.equal(result.materials[1].sources[0].status, 'unsupported');
  assert.match(result.materials[0].sources[0].url, /unsupported\/edit$/);
});
