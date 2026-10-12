import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientError } from '../dist/errors.js';
const conn = items => ({
  edges: items.map(node => ({ node })),
  pageInfo: { hasNextPage: false, endCursor: null },
});
const lesson = {
  id: 20,
  iri: '/api/lessons/20',
  number: 13,
  name: 'ORM / ../ Урок',
  url: 'https://lms.robotdreams.cc/course/1/lesson/20',
};
function reader(selected = lesson) {
  return {
    text: 'First version',
    courseName: 'Node.js',
    items: [1],
    failure: null,
    calls: [],
    async query(query) {
      this.calls.push(query);
      if (this.failure === 'all') throw new ClientError('NETWORK_ERROR', 'Offline', 5);
      if (query.includes('MaterialCourse'))
        return { course: { translations: conn([{ name: this.courseName }]) } };
      if (query.includes('ClientHomework')) {
        if (this.failure === 'homework') throw new ClientError('NETWORK_ERROR', 'Offline', 5);
        return {
          lesson: {
            id: selected.iri,
            homeworks: conn([
              {
                id: '/api/lesson_homeworks/30',
                _id: 30,
                translations: conn([
                  { locale: 'uk', empty: false, name: 'Task', description: `<p>${this.text}</p>` },
                ]),
              },
            ]),
          },
        };
      }
      if (query.includes('MaterialTypes'))
        return { lessonMaterialTypes: conn([{ _id: 0, name: 'file' }]) };
      if (query.includes('MaterialSubtitles'))
        return { lesson: { id: selected.iri, medias: conn([]) } };
      if (query.includes('ClientMaterials')) {
        if (this.failure === 'materials') throw new ClientError('NETWORK_ERROR', 'Offline', 5);
        return {
          lessonMaterialHasLessons: {
            collection: this.items.map(id => ({
              id: `relation-${id}`,
              position: id,
              lessonMaterial: {
                id: `/api/lesson_materials/${id}`,
                type: 0,
                subtitle: null,
                translations: conn([
                  {
                    locale: 'uk',
                    empty: false,
                    name: 'PDF',
                    description: '[]',
                    link: `https://cdn.example/${id}.pdf?Signature=private`,
                  },
                ]),
              },
            })),
            paginationInfo: { totalCount: this.items.length, hasNextPage: false },
          },
        };
      }
      if (query.includes('ClientVideoMedias'))
        return { lesson: { id: selected.iri, medias: conn([]) } };
      throw new Error('Unexpected query');
    },
  };
}
async function temp(t) {
  const p = await realpath(await mkdtemp(join(tmpdir(), 'lms-sync-')));
  t.after(() => rm(p, { recursive: true, force: true }));
  return p;
}
const pdf = '%PDF-1.4\nfixture';
const fetchFile = async () =>
  new Response(pdf, {
    headers: {
      'content-type': 'application/pdf',
      etag: '"v1"',
      'content-length': String(Buffer.byteLength(pdf)),
    },
  });

test('sync publishes fresh homework and materials, repeat refreshes conditionally and preserves existing snapshot', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const root = await temp(t),
    client = reader();
  let downloads = 0;
  const fetchImpl = async (_url, init) => {
    if (init.headers?.['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
    downloads++;
    return fetchFile();
  };
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl });
  assert.equal(first.status, 'complete');
  assert.match(await readFile(first.homework.files[0], 'utf8'), /First version/);
  assert.equal(first.video.status, 'not_requested');
  client.text = 'Changed assignment';
  client.items = [1, 2];
  const second = await syncLesson(client, 1, lesson, { root, fetchImpl });
  assert.match(await readFile(second.homework.files[0], 'utf8'), /Changed assignment/);
  assert.match(await readFile(first.homework.files[0], 'utf8'), /First version/);
  assert.equal(second.materials.data.materials.length, 2);
  assert.equal(second.materials.data.materials[0].sources[0].status, 'unchanged');
  assert.equal(downloads, 2);
  assert.doesNotMatch(await readFile(second.manifestPath, 'utf8'), /Signature=|[?&]secret=/);
  assert.equal(client.calls.filter(q => q.includes('ClientHomework')).length, 2);
  assert.equal(
    client.calls.some(q => q.includes('ClientVideo')),
    false,
  );
});
test('rename and colliding normalized names resolve by stable IDs', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const root = await temp(t),
    client = reader();
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  client.courseName = 'Renamed course';
  const second = await syncLesson(
    client,
    1,
    { ...lesson, name: 'Renamed lesson' },
    { root, fetchImpl: fetchFile },
  );
  assert.equal(first.directory, second.directory);
  const { getMaterials } = await import('../dist/materials.js');
  const standalone = await getMaterials(
    client,
    1,
    { ...lesson, name: 'Another rename' },
    { download: true, root, fetchImpl: fetchFile },
  );
  assert.equal(standalone.directory, first.directory);
  const nextLesson = { ...lesson, id: 21, iri: '/api/lessons/21' };
  const other = await syncLesson(reader(nextLesson), 1, nextLesson, { root, fetchImpl: fetchFile });
  assert.notEqual(other.directory, first.directory);
});
test('partial failures retain successful copies and their original freshness', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const root = await temp(t),
    client = reader();
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  client.failure = 'homework';
  const second = await syncLesson(client, 1, lesson, {
    root,
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.equal(second.status, 'partial');
  assert.equal(second.homework.status, 'stale');
  assert.equal(second.homework.fetchedAt, first.homework.fetchedAt);
  assert.equal(second.homework.files[0], first.homework.files[0]);
  const source = second.materials.data.materials[0].sources[0];
  assert.equal(source.status, 'stale');
  assert.equal(source.file, first.materials.data.materials[0].sources[0].file);
  assert.equal(source.errorCode, 'DOWNLOAD_UNAVAILABLE');
  assert.equal(
    client.calls.filter(q => q.includes('ClientHomework')).length,
    3,
    'one initial request plus two bounded attempts',
  );
});
test('cancelled sync leaves published manifest unchanged; parallel sync is refused', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const root = await temp(t),
    client = reader();
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  const published = await readFile(first.manifestPath, 'utf8');
  const controller = new AbortController();
  await assert.rejects(
    syncLesson(client, 1, lesson, {
      root,
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort();
        return fetchFile();
      },
    }),
    { code: 'CANCELLED' },
  );
  assert.equal(await readFile(first.manifestPath, 'utf8'), published);
  let unblock, entered;
  const started = new Promise(resolve => {
    entered = resolve;
  });
  const blocked = new Promise(resolve => {
    unblock = resolve;
  });
  const slow = syncLesson(client, 1, lesson, {
    root,
    fetchImpl: async () => {
      entered();
      await blocked;
      return fetchFile();
    },
  });
  await started;
  await assert.rejects(syncLesson(client, 1, lesson, { root }), { code: 'SYNC_BUSY' });
  unblock();
  await slow;
});
test('corrupt local cache is downloaded again; failed new material is explicit', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const root = await temp(t),
    client = reader();
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  await writeFile(first.materials.files[0], Buffer.alloc(Buffer.byteLength(pdf)));
  client.items = [1, 2];
  const result = await syncLesson(client, 1, lesson, {
    root,
    fetchImpl: async (url, init) => {
      assert.equal(init.headers?.['If-None-Match'], undefined);
      return String(url).includes('/2.pdf') ? new Response(null, { status: 403 }) : fetchFile();
    },
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.materials.data.materials[1].sources[0].status, 'unavailable');
  assert.equal(result.materials.data.materials[1].sources[0].file, null);
  assert.deepEqual((await readdir(result.directory)).includes('manifest.json'), true);
});
test('explicit --video records failures without hiding text context', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const result = await syncLesson(reader(), 1, lesson, {
    root: await temp(t),
    fetchImpl: fetchFile,
    video: true,
    quality: 1080,
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.video.status, 'failed');
  assert.equal(result.video.errorCode, 'VIDEO_NOT_FOUND');
  assert.deepEqual(result.video.errorDetails.recordings, []);
  assert.equal(result.homework.status, 'fresh');
});

test('LMS VTT is fetched with public Referer and appears as a local timed transcript', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const client = reader(),
    base = client.query.bind(client);
  client.query = async (query, vars) =>
    query.includes('MaterialSubtitles')
      ? {
          lesson: {
            id: lesson.iri,
            medias: conn([
              {
                id: '/api/lesson_media/10',
                subtitle: { contentUrl: 'https://cdn.example/sub.vtt?Signature=private' },
              },
            ]),
          },
        }
      : base(query, vars);
  const root = await temp(t);
  const result = await syncLesson(client, 1, lesson, {
    root,
    fetchImpl: async (url, init) => {
      if (String(url).includes('.vtt')) {
        assert.equal(init.headers.Referer, 'https://lms.robotdreams.cc/');
        assert.equal(init.headers.Authorization, undefined);
        return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nПривіт\n', {
          headers: { 'content-type': 'text/vtt' },
        });
      }
      return fetchFile();
    },
  });
  assert.equal(result.materials.data.transcriptStatus, 'available');
  assert.match(await readFile(result.materials.data.subtitles[0].textFile, 'utf8'), /Привіт/);
  const stale = await syncLesson(client, 1, lesson, {
    root,
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.equal(stale.materials.data.subtitles[0].status, 'stale');
  assert.match(await readFile(stale.materials.data.subtitles[0].textFile, 'utf8'), /Привіт/);
});

test('validators from a redirect destination are not reused for the original URI', async t => {
  const { downloadFile } = await import('../dist/download.js');
  const file = join(await temp(t), 'asset.pdf');
  const result = await downloadFile('https://cdn.example/redirect', file, {
    kind: 'pdf',
    fetchImpl: async url =>
      String(url).endsWith('/redirect')
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://files.example/asset.pdf' },
          })
        : fetchFile(),
  });
  assert.equal(result.etag, null);
});

test('materials API failure retains the last complete material list and source paths', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const client = reader(),
    root = await temp(t);
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  client.failure = 'materials';
  client.text = 'New task, API for files is down';
  const second = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  assert.equal(second.materials.status, 'stale');
  assert.equal(second.materials.fetchedAt, first.materials.fetchedAt);
  assert.deepEqual(second.materials.files, first.materials.files);
  assert.match(await readFile(second.homework.files[0], 'utf8'), /New task/);
});
test('manifest rejects paths outside the lesson and preserves the published file', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const client = reader(),
    root = await temp(t);
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  const manifest = JSON.parse(await readFile(first.manifestPath, 'utf8'));
  manifest.homework.files = ['/etc/passwd'];
  await writeFile(first.manifestPath, JSON.stringify(manifest));
  const before = await readFile(first.manifestPath, 'utf8');
  await assert.rejects(syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile }), {
    code: 'MANIFEST_INVALID',
  });
  assert.equal(await readFile(first.manifestPath, 'utf8'), before);
});
test('missing homework is refreshed; escaped JSON signed URLs are removed from persisted context', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const client = reader(),
    base = client.query.bind(client),
    root = await temp(t);
  client.text = '<a href="https://cdn.example/file?Signature=secret-value">Link</a>';
  client.query = async (query, vars) => {
    const data = await base(query, vars);
    if (query.includes('ClientHomework'))
      data.lesson.homeworks.edges[0].node.translations.edges[0].node.description = JSON.stringify([
        { type: 'text', content: `<p>${client.text}</p>` },
      ]).replaceAll('/', '\\/');
    return data;
  };
  const first = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  assert.doesNotMatch(await readFile(first.manifestPath, 'utf8'), /secret-value|Signature=/);
  assert.doesNotMatch(await readFile(first.homework.files[0], 'utf8'), /secret-value|Signature=/);
  client.query = async (query, vars) =>
    query.includes('ClientHomework')
      ? { lesson: { id: lesson.iri, homeworks: conn([]) } }
      : base(query, vars);
  const second = await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  assert.equal(second.homework.data.status, 'no_homework');
  assert.match(await readFile(second.homework.files[0], 'utf8'), /немає домашнього/);
});
test('query changes at the same public URL cannot reuse another resource validator', async t => {
  const { syncLesson } = await import('../dist/sync.js');
  const client = reader(),
    base = client.query.bind(client),
    root = await temp(t);
  let identity = 'one';
  client.query = async (query, vars) => {
    const data = await base(query, vars);
    if (query.includes('ClientMaterials'))
      data.lessonMaterialHasLessons.collection[0].lessonMaterial.translations.edges[0].node.link = `https://cdn.example/a.pdf?file=${identity}`;
    return data;
  };
  await syncLesson(client, 1, lesson, { root, fetchImpl: fetchFile });
  identity = 'two';
  const second = await syncLesson(client, 1, lesson, {
    root,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['If-None-Match'], undefined);
      return fetchFile();
    },
  });
  assert.equal(second.materials.data.materials[0].sources[0].status, 'downloaded');
});

test('scrubbing signed URLs keeps ordinary query examples in the assignment intact', async () => {
  const { withoutTemporaryUrls } = await import('../dist/manifest.js');
  assert.equal(
    withoutTemporaryUrls('GET https://example.test/users?limit=10&active=true#example'),
    'GET https://example.test/users?limit=10&active=true#example',
  );
  assert.equal(
    withoutTemporaryUrls(
      'https://cdn.example/file?X-Amz-Signature=secret&X-Amz-Date=20261012#part',
    ),
    'https://cdn.example/file',
  );
});
