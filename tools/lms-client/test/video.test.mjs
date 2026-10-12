import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as downloads from '../dist/download.js';

const bytes = Buffer.concat([Buffer.from('0000ftypisom'), Buffer.alloc(128, 42)]);
const source = async () => ({
  url: 'https://cdn.example/video?secret=temporary',
  identity: 'resolution:10',
});
const response = (start = 0, status = 206, etag = '"original"') =>
  new Response(bytes.subarray(start), {
    status,
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(bytes.length - start),
      ...(status === 206
        ? { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` }
        : {}),
      ...(etag ? { etag } : {}),
    },
  });
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lms-video-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'video.mp4');
}
function broken(etag = '"original"', part) {
  let sent = false;
  let cancelled = false;
  return new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
      async pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(bytes.subarray(0, 32));
        } else {
          // Wait until the writer committed the first chunk, rather than racing disk I/O.
          if (part) {
            for (let attempt = 0; attempt < 1000 && !cancelled; attempt++) {
              const saved = await readFile(part).catch(() => Buffer.alloc(0));
              if (saved.length >= 32) break;
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          if (!cancelled) controller.error(new Error('connection lost'));
        }
      },
    }),
    {
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(bytes.length),
        ...(etag ? { etag } : {}),
      },
    },
  );
}
test('video streams to MP4; repeat verifies hash and validator without a second full transfer', async t => {
  const file = await fixture(t);
  let transfers = 0;
  const fetchImpl = async (_url, init) => {
    if (init.headers.Range === 'bytes=0-0') return response();
    transfers++;
    return response(0, 200);
  };
  const result = await downloads.downloadVideo(source, file, { fetchImpl });
  assert.equal(result.status, 'downloaded');
  assert.deepEqual(await readFile(file), bytes);
  assert.equal(
    (await downloads.downloadVideo(source, file, { fetchImpl })).status,
    'already_downloaded',
  );
  assert.equal(transfers, 1);
  assert.doesNotMatch(await readFile(`${file}.json`, 'utf8'), /secret|https|temporary/);
  await writeFile(file, Buffer.alloc(bytes.length));
  assert.equal((await downloads.downloadVideo(source, file, { fetchImpl })).status, 'downloaded');
  assert.equal(transfers, 2);
});
for (const mode of ['resume', '200', 'changed', 'no-validator', 'corrupt-part']) {
  test(`interrupted video: ${mode}`, async t => {
    const file = await fixture(t);
    const etag = mode === 'no-validator' ? null : '"original"';
    await assert.rejects(
      downloads.downloadVideo(source, file, {
        attempts: 1,
        fetchImpl: async (_url, init) =>
          init.headers.Range === 'bytes=0-0'
            ? response(0, 206, etag)
            : broken(etag, `${file}.part`),
      }),
      { code: 'DOWNLOAD_FAILED' },
    );
    assert.equal((await readFile(`${file}.part`)).length, 32);
    if (mode === 'corrupt-part') await writeFile(`${file}.part`, Buffer.alloc(32));
    const requests = [];
    const newEtag = mode === 'changed' ? '"changed"' : etag;
    await downloads.downloadVideo(source, file, {
      fetchImpl: async (_url, init) => {
        if (init.headers.Range === 'bytes=0-0') return response(0, 206, newEtag);
        requests.push(init.headers);
        const start = Number(/bytes=(\d+)-/.exec(init.headers.Range ?? '')?.[1] ?? 0);
        return response(mode === '200' ? 0 : start, mode === '200' || !start ? 200 : 206, newEtag);
      },
    });
    assert.equal(requests[0].Range, ['resume', '200'].includes(mode) ? 'bytes=32-' : undefined);
    if (mode === 'resume') assert.equal(requests[0]['If-Range'], '"original"');
    assert.deepEqual(await readFile(file), bytes);
  });
}
test('expired URL refresh is bounded and never written to metadata', async t => {
  const file = await fixture(t);
  let refreshes = 0;
  const fresh = async () => {
    refreshes++;
    return source();
  };
  await downloads.downloadVideo(fresh, file, {
    fetchImpl: async () =>
      refreshes === 1 ? new Response(null, { status: 403 }) : response(0, 200),
  });
  assert.equal(refreshes, 2);
  refreshes = 0;
  await assert.rejects(
    downloads.downloadVideo(fresh, file, {
      fetchImpl: async () => new Response(null, { status: 403 }),
    }),
    { code: 'DOWNLOAD_UNAVAILABLE' },
  );
  assert.equal(refreshes, 3);
});
test('wrong range, MIME, truncated and fake MP4 are rejected without publishing', async t => {
  for (const invalid of ['range', 'mime', 'length', 'signature']) {
    const file = `${await fixture(t)}-${invalid}`;
    const fetchImpl = async (_url, init) => {
      if (init.headers.Range === 'bytes=0-0') return response();
      const r = response(0, invalid === 'range' ? 206 : 200);
      if (invalid === 'range')
        r.headers.set('content-range', `bytes 1-${bytes.length}/${bytes.length + 1}`);
      if (invalid === 'mime') r.headers.set('content-type', 'text/html');
      if (invalid === 'length') r.headers.set('content-length', String(bytes.length + 1));
      return invalid === 'signature'
        ? new Response(Buffer.alloc(bytes.length), { headers: r.headers })
        : r;
    };
    await assert.rejects(downloads.downloadVideo(source, file, { fetchImpl, attempts: 1 }), {
      code: 'DOWNLOAD_INVALID',
    });
    await assert.rejects(readFile(file), { code: 'ENOENT' });
  }
});
test('cancellation is explicit, insufficient space prevents the body download', async t => {
  const file = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(downloads.downloadVideo(source, file, { signal: controller.signal }), {
    code: 'CANCELLED',
    exitCode: 130,
  });
  let calls = 0;
  await assert.rejects(
    downloads.downloadVideo(source, file, {
      fetchImpl: async () => {
        calls++;
        return response();
      },
      availableBytes: async () => 0,
    }),
    { code: 'DISK_FULL' },
  );
  assert.equal(calls, 1);
});

test('recording and quality selection never silently drops alternatives', async () => {
  const { selectRecording } = await import('../dist/video.js');
  const recordings = [
    { id: 10, name: null, qualities: [720, 1080] },
    { id: 11, name: 'part 2', qualities: [720] },
  ];
  assert.throws(
    () => selectRecording(recordings, { quality: 1080 }),
    error => {
      assert.equal(error.code, 'VIDEO_SELECTION_REQUIRED');
      assert.deepEqual(error.details.recordings, recordings);
      return true;
    },
  );
  assert.throws(
    () => selectRecording(recordings, { quality: 1080, mediaId: 11 }),
    error => {
      assert.equal(error.code, 'VIDEO_QUALITY_UNAVAILABLE');
      assert.deepEqual(error.details.recordings, recordings);
      return true;
    },
  );
  assert.equal(selectRecording(recordings, { quality: 720, mediaId: 11 }).id, 11);
  assert.equal(selectRecording([recordings[0]], { quality: 1080 }).id, 10);
  assert.throws(() => selectRecording([], { quality: 1080 }), { code: 'VIDEO_NOT_FOUND' });
});

test('LMS recording/resolution pagination and download use stable IDs and fresh URLs', async t => {
  const { getVideo } = await import('../dist/video.js');
  const file = await fixture(t);
  const connection = (items, cursor = null) => ({
    edges: items.map(node => ({ node })),
    pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
  });
  let refreshes = 0;
  const client = {
    async query(query, variables) {
      if (query.includes('MaterialCourse'))
        return { course: { translations: connection([{ name: 'Node.js' }]) } };
      if (query.includes('ClientVideoMedias'))
        return {
          lesson: {
            id: '/api/lessons/20',
            medias: variables.after
              ? connection([{ id: '/api/lesson_media/11', name: 'second' }])
              : connection([{ id: '/api/lesson_media/10', name: null }], 'next'),
          },
        };
      if (query.includes('ClientVideoResolutions')) {
        const id = variables.media.endsWith('/10') ? 100 : 200;
        if (variables.after) {
          refreshes++;
          return {
            lessonMediaResolutions: connection([
              {
                id: `/api/lesson_media_resolutions/${id + 1}`,
                type: 1080,
                durationInSeconds: 50,
                link: `https://cdn.example/video?secret=${refreshes}`,
              },
            ]),
          };
        }
        return {
          lessonMediaResolutions: connection(
            [
              {
                id: `/api/lesson_media_resolutions/${id}`,
                type: 720,
                durationInSeconds: 50,
                link: 'https://cdn.example/720',
              },
            ],
            'resolution-next',
          ),
        };
      }
      throw new Error('Unexpected query');
    },
  };
  const result = await getVideo(
    client,
    1,
    { id: 20, iri: '/api/lessons/20', name: 'Streams' },
    {
      quality: 1080,
      mediaId: 10,
      root: join(file, '..'),
      fetchImpl: async (_url, init) => (init.headers.Range ? response() : response(0, 200)),
    },
  );
  assert.equal(result.recordings.length, 2);
  assert.deepEqual(result.recordings[0].qualities, [720, 1080]);
  assert.ok(refreshes >= 3, 'refresh selected resolution after enumerating alternatives');
  assert.doesNotMatch(JSON.stringify(result), /secret|https:\/\/cdn/);
});

test('LMS CDN requests carry the public LMS Referer without authentication', async t => {
  const { getVideo } = await import('../dist/video.js');
  const file = await fixture(t);
  const conn = items => ({
    edges: items.map(node => ({ node })),
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  const client = {
    async query(query) {
      if (query.includes('MaterialCourse')) return { course: { translations: conn([]) } };
      if (query.includes('ClientVideoMedias'))
        return {
          lesson: {
            id: '/api/lessons/20',
            medias: conn([{ id: '/api/lesson_media/10', name: null }]),
          },
        };
      return {
        lessonMediaResolutions: conn([
          {
            id: '/api/lesson_media_resolutions/100',
            type: 1080,
            link: 'https://cdn.example/video',
            durationInSeconds: 10,
          },
        ]),
      };
    },
  };
  await getVideo(
    client,
    1,
    { id: 20, iri: '/api/lessons/20', name: null },
    {
      quality: 1080,
      root: join(file, '..'),
      fetchImpl: async (_url, init) => {
        assert.equal(init.headers.Referer, 'https://lms.robotdreams.cc/');
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.headers.Cookie, undefined);
        return init.headers.Range ? response() : response(0, 200);
      },
    },
  );
});

test('URL expiry after interruption refreshes and resumes the same representation', async t => {
  const file = await fixture(t);
  let refreshes = 0;
  const fresh = async () => {
    refreshes++;
    return source();
  };
  await downloads.downloadVideo(fresh, file, {
    fetchImpl: async (_url, init) => {
      if (refreshes === 2) return new Response(null, { status: 403 });
      if (init.headers.Range === 'bytes=0-0') return response();
      if (refreshes === 1) return broken(undefined, `${file}.part`);
      assert.equal(init.headers.Range, 'bytes=32-');
      return response(32);
    },
  });
  assert.equal(refreshes, 3);
  assert.deepEqual(await readFile(file), bytes);
});
test('mid-stream Ctrl+C preserves checkpoint and releases the lock', async t => {
  const file = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(
    downloads.downloadVideo(source, file, {
      signal: controller.signal,
      fetchImpl: async (_url, init) =>
        init.headers.Range === 'bytes=0-0' ? response() : broken(undefined, `${file}.part`),
      onProgress: received => {
        if (received >= 32) controller.abort();
      },
    }),
    { code: 'CANCELLED', exitCode: 130 },
  );
  const state = JSON.parse(await readFile(`${file}.json`, 'utf8'));
  assert.equal(state.complete, false);
  await downloads.downloadVideo(source, file, {
    fetchImpl: async (_url, init) => {
      if (init.headers.Range === 'bytes=0-0') return response();
      const start = Number(/bytes=(\d+)-/.exec(init.headers.Range ?? '')?.[1] ?? 0);
      return response(start, start ? 206 : 200);
    },
  });
  assert.deepEqual(await readFile(file), bytes);
});
test('two processes cannot append to the same video; idle transfer has bounded retries', async t => {
  const file = await fixture(t);
  let unlock;
  let entered;
  const started = new Promise(resolve => {
    entered = resolve;
  });
  const blocked = new Promise(resolve => {
    unlock = resolve;
  });
  const first = downloads.downloadVideo(
    async () => {
      entered();
      await blocked;
      return source();
    },
    file,
    { fetchImpl: async () => response(0, 200) },
  );
  await started;
  await assert.rejects(downloads.downloadVideo(source, file), { code: 'VIDEO_BUSY' });
  unlock();
  await first;
  await assert.rejects(
    downloads.downloadVideo(source, `${file}-idle`, {
      attempts: 1,
      idleTimeoutMs: 30,
      fetchImpl: async (_url, init) => {
        if (init.headers.Range === 'bytes=0-0') return response();
        return new Response(new ReadableStream({ start() {} }), {
          headers: response(0, 200).headers,
        });
      },
    }),
    { code: 'DOWNLOAD_FAILED' },
  );
});
test('weak ETag alone restarts; Last-Modified can validate a range', async t => {
  for (const lastModified of [null, 'Wed, 09 Sep 2026 16:06:03 GMT']) {
    const file = await fixture(t);
    const addHeaders = r => {
      r.headers.set('etag', 'W/"weak"');
      if (lastModified) r.headers.set('last-modified', lastModified);
      return r;
    };
    await assert.rejects(
      downloads.downloadVideo(source, file, {
        attempts: 1,
        fetchImpl: async (_url, init) =>
          addHeaders(
            init.headers.Range === 'bytes=0-0' ? response() : broken(undefined, `${file}.part`),
          ),
      }),
      { code: 'DOWNLOAD_FAILED' },
    );
    await downloads.downloadVideo(source, file, {
      fetchImpl: async (_url, init) => {
        if (init.headers.Range === 'bytes=0-0') return addHeaders(response());
        assert.equal(init.headers.Range, lastModified ? 'bytes=32-' : undefined);
        assert.equal(init.headers['If-Range'], lastModified ?? undefined);
        return addHeaders(response(lastModified ? 32 : 0, lastModified ? 206 : 200));
      },
    });
  }
});

test('legacy standalone complete video moves without full transfer and hides its metadata', async t => {
  const legacy = await fixture(t),
    target = join(legacy, '..', 'lecture.mp4'),
    metadata = join(legacy, '..', '.lms', 'lecture.mp4.json');
  await downloads.downloadVideo(source, legacy, {
    fetchImpl: async (_url, init) =>
      init.headers.Range === 'bytes=0-0'
        ? new Response(bytes.subarray(0, 1), {
            status: 206,
            headers: {
              'content-type': 'video/mp4',
              'content-range': `bytes 0-0/${bytes.length}`,
              'content-length': '1',
              etag: '"original"',
            },
          })
        : response(0, 200),
  });
  let requests = 0;
  const result = await downloads.downloadVideo(source, target, {
    legacyTarget: legacy,
    metadataPath: metadata,
    fetchImpl: async (_url, init) => {
      requests++;
      assert.equal(init.headers.Range, 'bytes=0-0');
      return new Response(bytes.subarray(0, 1), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': `bytes 0-0/${bytes.length}`,
          'content-length': '1',
          etag: '"original"',
        },
      });
    },
  });
  assert.equal(result.status, 'already_downloaded');
  assert.equal(requests, 1);
  assert.equal(result.metadata, metadata);
  await assert.rejects(readFile(legacy), { code: 'ENOENT' });
});
test('legacy standalone partial video resumes after migration', async t => {
  const { createHash } = await import('node:crypto');
  const legacy = await fixture(t),
    target = join(legacy, '..', 'lecture.mp4');
  const prefix = bytes.subarray(0, 32);
  await writeFile(legacy + '.part', prefix);
  await writeFile(
    legacy + '.json',
    JSON.stringify({
      version: 1,
      identity: 'resolution:10',
      total: bytes.length,
      validator: '"original"',
      bytes: prefix.length,
      sha256: createHash('sha256').update(prefix).digest('hex'),
      complete: false,
    }),
  );
  let resumed = false;
  const result = await downloads.downloadVideo(source, target, {
    legacyTarget: legacy,
    fetchImpl: async (_url, init) => {
      if (init.headers.Range === 'bytes=0-0')
        return new Response(bytes.subarray(0, 1), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': `bytes 0-0/${bytes.length}`,
            'content-length': '1',
            etag: '"original"',
          },
        });
      assert.equal(init.headers.Range, 'bytes=32-');
      resumed = true;
      return response(32);
    },
  });
  assert.equal(result.status, 'downloaded');
  assert.equal(resumed, true);
  assert.deepEqual(await readFile(target), bytes);
});
