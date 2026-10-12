import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, writeFile, symlink, mkdir, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { CookieJar } from 'tough-cookie';

let tokenSequence = 0;
const token = () => `opaque-test-token-${++tokenSequence}`;
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lms-auth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  let refreshStatus = 200,
    readStatus = 200,
    loginStatus = 200,
    graphqlErrors = false,
    graphqlBody,
    loginCookies = true,
    expiry = Math.floor(Date.now() / 1000) + 3600;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({
      path: req.url,
      cookie: req.headers.cookie,
      bearer: req.headers.authorization,
      body: raw,
    });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/login')) {
      res.statusCode = loginStatus;
      if (loginCookies)
        res.setHeader('set-cookie', [
          'REMEMBERME=test-session; Path=/; HttpOnly; Max-Age=604800',
          'scoped=private; Path=/private',
        ]);
      res.end(
        JSON.stringify(
          loginStatus === 200
            ? { access_token: token(), expires_in_seconds: expiry }
            : { message: 'secret-response' },
        ),
      );
    } else if (req.url === '/api/token/refresh') {
      res.statusCode = req.headers.cookie?.includes('REMEMBERME=') ? refreshStatus : 401;
      res.setHeader('set-cookie', 'REMEMBERME=rotated-session; Path=/; HttpOnly; Max-Age=604800');
      res.end(JSON.stringify({ access_token: token(), expires_in_seconds: expiry }));
    } else {
      res.statusCode = readStatus;
      res.end(
        JSON.stringify(
          graphqlBody ??
            (graphqlErrors || JSON.parse(raw).variables.id !== '/api/courses/5467'
              ? { errors: [{ message: 'private-server-error' }] }
              : {
                  data: {
                    course: {
                      id: '/api/courses/5467',
                      translations: { edges: [{ node: { name: 'Node.js PRO' } }] },
                    },
                  },
                }),
        ),
      );
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { AuthClient } = await import('../dist/auth.js');
  const { SessionStore } = await import('../dist/session-store.js');
  const store = new SessionStore(directory);
  const client = new AuthClient({ store, authOrigin: origin, graphqlUrl: `${origin}/api/graphql` });
  return {
    directory,
    calls,
    client,
    store,
    origin,
    setRefreshStatus: s => (refreshStatus = s),
    setReadStatus: s => (readStatus = s),
    setLoginStatus: s => (loginStatus = s),
    setGraphqlErrors: value => (graphqlErrors = value),
    setGraphqlBody: value => (graphqlBody = value),
    setLoginCookies: value => (loginCookies = value),
    setExpiry: value => (expiry = value),
  };
}

test('login persists only token and cookie jar with private permissions', async t => {
  const f = await fixture(t);
  await f.client.login({ email: 'student@example.invalid', password: 'private-password' });
  const raw = await readFile(join(f.directory, 'session.json'), 'utf8');
  assert.ok(!raw.includes('private-password'));
  assert.ok(!raw.includes('student@example.invalid'));
  const saved = JSON.parse(raw);
  assert.equal(saved.version, 1);
  assert.ok(saved.accessToken);
  assert.ok(saved.expiresAt > Date.now());
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(f.directory, 'session.json'))).mode & 0o777, 0o600);
  const jar = CookieJar.deserializeSync(saved.cookieJar);
  assert.match(await jar.getCookieString(f.origin + '/api/token/refresh'), /REMEMBERME/);
  assert.doesNotMatch(await jar.getCookieString(f.origin + '/api/token/refresh'), /scoped/);
  assert.equal(await jar.getCookieString('https://example.org/'), '');
});

test('opaque token uses the absolute server expiry without adding it to Date.now', async t => {
  const f = await fixture(t);
  const expiry = Math.floor(Date.now() / 1000) + 7200;
  f.setExpiry(expiry);
  const result = await f.client.login({ email: 'a@b.test', password: 'p' });
  assert.equal(result.expiresAt, new Date(expiry * 1000).toISOString());
  await f.client.readCourse();
  assert.equal(f.calls.filter(c => c.path === '/api/token/refresh').length, 0);
  assert.match(f.calls.at(-1).bearer, /^Bearer opaque-test-token-/);
});

test('invalid login and refresh expiry never overwrite an existing session', async t => {
  const f = await fixture(t);
  await f.client.login({ email: 'a@b.test', password: 'p' });
  const before = await readFile(join(f.directory, 'session.json'), 'utf8');
  for (const expiry of [
    undefined,
    null,
    'tomorrow',
    '2000000000',
    0,
    -1,
    1.5,
    3600,
    Math.floor(Date.now() / 1000) - 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    f.setExpiry(expiry);
    await assert.rejects(f.client.login({ email: 'a@b.test', password: 'p' }), {
      code: 'API_RESPONSE_INVALID',
    });
    await assert.rejects(f.client.checkSession(), { code: 'API_RESPONSE_INVALID' });
    assert.equal(await readFile(join(f.directory, 'session.json'), 'utf8'), before);
  }
});

test('login without refresh cookies does not claim a persistent session', async t => {
  const f = await fixture(t);
  f.setLoginCookies(false);
  await assert.rejects(f.client.login({ email: 'a@b.test', password: 'p' }), {
    code: 'API_RESPONSE_INVALID',
  });
  await assert.rejects(readFile(join(f.directory, 'session.json')), { code: 'ENOENT' });
});

test('separate process restores jar, refreshes token and reads course', async t => {
  const f = await fixture(t);
  await f.client.login({ email: 'a@b.test', password: 'p' });
  const initial = JSON.parse(await readFile(join(f.directory, 'session.json'), 'utf8'));
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import {AuthClient} from './dist/auth.js'; import {SessionStore} from './dist/session-store.js';
    const client=new AuthClient({store:new SessionStore(process.env.TEST_STORE),authOrigin:process.env.TEST_ORIGIN,graphqlUrl:process.env.TEST_ORIGIN+'/api/graphql'});
    console.log(JSON.stringify(await client.checkSession()));
  `,
    ],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, TEST_STORE: f.directory, TEST_ORIGIN: f.origin },
    },
  );
  let out = '',
    err = '';
  child.stdout.on('data', c => (out += c));
  child.stderr.on('data', c => (err += c));
  const [exit] = await once(child, 'close');
  assert.equal(exit, 0, err);
  assert.equal(JSON.parse(out).course.name, 'Node.js PRO');
  assert.equal(f.calls.filter(c => c.path === '/api/token/refresh').length, 1);
  assert.match(f.calls[1].cookie, /REMEMBERME=test-session/);
  assert.match(f.calls[2].bearer, /^Bearer /);
  const refreshed = JSON.parse(await readFile(join(f.directory, 'session.json'), 'utf8'));
  assert.notEqual(refreshed.accessToken, initial.accessToken);
  assert.equal(f.calls[2].bearer, `Bearer ${refreshed.accessToken}`);
  assert.match(
    CookieJar.deserializeSync(refreshed.cookieJar).getCookieStringSync(f.origin + '/'),
    /REMEMBERME=rotated-session/,
  );
});

test('missing session, wrong password and revoked session have safe errors', async t => {
  const f = await fixture(t);
  await assert.rejects(f.client.checkSession(), { code: 'AUTH_REQUIRED' });
  f.setLoginStatus(401);
  await assert.rejects(f.client.login({ email: 'a@b.test', password: 'p' }), {
    code: 'LOGIN_FAILED',
  });
  await assert.rejects(readFile(join(f.directory, 'session.json')), { code: 'ENOENT' });
  f.setLoginStatus(200);
  await f.client.login({ email: 'a@b.test', password: 'p' });
  f.setRefreshStatus(401);
  await assert.rejects(f.client.checkSession(), { code: 'AUTH_REQUIRED' });
  await assert.rejects(readFile(join(f.directory, 'session.json')), { code: 'ENOENT' });
});

test('expired token refreshes in advance, persistent 401 retries only once', async t => {
  const f = await fixture(t);
  await f.client.login({ email: 'a@b.test', password: 'p' });
  await f.store.transaction(async tx => {
    const s = await tx.read();
    s.expiresAt = Date.now() - 1000;
    await tx.write(s);
  });
  await f.client.readCourse();
  assert.equal(f.calls.filter(c => c.path === '/api/token/refresh').length, 1);
  f.setReadStatus(401);
  await assert.rejects(f.client.readCourse(), { code: 'AUTH_REQUIRED' });
  assert.equal(f.calls.filter(c => c.path === '/api/graphql').length, 3);
  assert.equal(f.calls.filter(c => c.path === '/api/token/refresh').length, 2);
});

test('parallel processes serialize updates and logout works with corrupt file', async t => {
  const f = await fixture(t);
  await f.client.login({ email: 'a@b.test', password: 'p' });
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import {SessionStore} from './dist/session-store.js';
      await new SessionStore(process.env.TEST_STORE).transaction(async tx=>{
        const s=await tx.read();s.counter=(s.counter??0)+1;
        await new Promise(r=>setTimeout(r,100));await tx.write(s);
      });
    `,
        ],
        {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, TEST_STORE: f.directory },
          stdio: 'pipe',
        },
      );
      let err = '';
      child.stderr.on('data', c => (err += c));
      assert.equal((await once(child, 'close'))[0], 0, err);
    }),
  );
  assert.equal(JSON.parse(await readFile(join(f.directory, 'session.json'), 'utf8')).counter, 4);
  await writeFile(join(f.directory, 'session.json'), '{broken');
  await assert.rejects(f.client.checkSession(), { code: 'SESSION_INVALID' });
  await f.client.logout();
  await f.client.logout();
  await assert.rejects(readFile(join(f.directory, 'session.json')), { code: 'ENOENT' });
});

test('stale lock is recovered and server errors keep the previous session', async t => {
  const f = await fixture(t);
  await f.client.login({ email: 'a@b.test', password: 'p' });
  const before = await readFile(join(f.directory, 'session.json'), 'utf8');
  await mkdir(join(f.directory, 'session.json.lock'));
  const old = new Date(Date.now() - 60_000);
  await utimes(join(f.directory, 'session.json.lock'), old, old);
  f.setLoginStatus(500);
  await assert.rejects(f.client.login({ email: 'a@b.test', password: 'p' }), {
    code: 'HTTP_ERROR',
  });
  assert.equal(await readFile(join(f.directory, 'session.json'), 'utf8'), before);
  f.setRefreshStatus(500);
  await assert.rejects(f.client.checkSession(), { code: 'HTTP_ERROR' });
  assert.equal(await readFile(join(f.directory, 'session.json'), 'utf8'), before);
  f.setRefreshStatus(200);
  f.setGraphqlErrors(true);
  await assert.rejects(f.client.readCourse(), { code: 'GRAPHQL_ERROR' });
});

test('cookie expiry, Secure and redirect boundaries are respected', async () => {
  const jar = new CookieJar();
  await jar.setCookie('expired=gone; Max-Age=0; Path=/', 'https://lms.example.test/');
  await jar.setCookie('secret=value; Secure; Path=/', 'https://lms.example.test/');
  assert.equal(await jar.getCookieString('http://lms.example.test/'), '');
  assert.match(await jar.getCookieString('https://lms.example.test/'), /secret=value/);
  assert.equal(await jar.getCookieString('https://graphql.example.test/'), '');
  const { HttpClient } = await import('../dist/http.js');
  const server = createServer((_req, res) => {
    res.writeHead(302, { location: 'https://example.org/' });
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(
      new HttpClient().request(`http://127.0.0.1:${server.address().port}/`, jar),
      { code: 'AUTH_INTERACTION_REQUIRED' },
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('HTTP timeout is bounded and never includes server details', async () => {
  const { HttpClient } = await import('../dist/http.js');
  const server = createServer(() => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(
      new HttpClient(30).request(`http://127.0.0.1:${server.address().port}/`, new CookieJar()),
      { code: 'NETWORK_ERROR' },
    );
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('session symlink is rejected without reading or changing its target', async t => {
  const f = await fixture(t);
  const target = join(f.directory, 'target.json');
  await writeFile(target, 'private-target');
  await symlink(target, join(f.directory, 'session.json'));
  await assert.rejects(f.client.checkSession(), { code: 'SESSION_INVALID' });
  assert.equal(await readFile(target, 'utf8'), 'private-target');
});

test('cleanup failure preserves the original operation error', async t => {
  const f = await fixture(t);
  const original = new Error('original operation failed');
  await assert.rejects(
    f.store.transaction(async () => {
      // A nonempty lock directory makes release fail with ENOTEMPTY.
      await writeFile(join(f.directory, 'session.json.lock', 'obstruction'), 'test');
      throw original;
    }),
    error => error === original,
  );
});

test('JSON from disk is validated before being treated as a Session', async t => {
  const f = await fixture(t);
  for (const invalid of [
    null,
    [],
    { version: 2 },
    { version: 1, accessToken: 'x', expiresAt: 'tomorrow', cookieJar: { cookies: [] } },
  ]) {
    await writeFile(join(f.directory, 'session.json'), JSON.stringify(invalid));
    await assert.rejects(f.client.checkSession(), { code: 'SESSION_INVALID' });
  }
});

test('generic GraphQL reader preserves variables and rejects malformed or partial envelopes', async t => {
  const f = await fixture(t);
  const { GraphqlClient } = await import('../dist/graphql.js');
  const reader = new GraphqlClient(f.client);
  await f.client.login({ email: 'a@b.test', password: 'p' });
  const query = 'query Probe($course: String!) { lessons(course: $course) { collection { id } } }';
  const variables = { course: '/api/courses/999' };
  f.setGraphqlBody({ data: { lessons: { collection: [] } } });
  assert.deepEqual(await reader.query(query, variables), { lessons: { collection: [] } });
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { query, variables });
  for (const body of [{}, { data: [] }, { data: {}, errors: 'private-error' }]) {
    f.setGraphqlBody(body);
    await assert.rejects(reader.query(query, variables), { code: 'API_RESPONSE_INVALID' });
  }
  f.setGraphqlBody({ data: { lessons: null }, errors: [{ message: 'private-error' }] });
  await assert.rejects(
    reader.query(query, variables),
    error => error.code === 'GRAPHQL_ERROR' && !error.message.includes('private-error'),
  );
});
