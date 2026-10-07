import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = (args, cwd) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd,
  });

test('help is one JSON response, including command-specific help', () => {
  for (const args of [[], ['--help'], ['help'], ['homework', '--help']]) {
    const result = run(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.match(body.data.usage, /lms/);
  }
});

test('invalid arguments produce JSON and usage exit code', () => {
  const invalid = [
    ['unknown'],
    ['lessons', '--unknown'],
    ['lessons', 'extra'],
    ['homework'],
    ['homework', '--lesson', '0'],
    ['homework', '--lesson', '1.5'],
    ['lessons', '--course', '-1'],
    ['lessons', '--course', '9007199254740992'],
    ['lessons', '--course'],
    ['lessons', '--course', '1', '--course', '2'],
    ['homework', '--latest', '--lesson', '13'],
    ['homework', '--lesson-id', '104319', '--lesson', '13'],
    ['login', '--course', '5467'],
    ['login', '--password', 'dummy'],
    ['materials', '--video'],
    ['sync', '--latest', '--quality', '720'],
    ['video', '--latest', '--quality', '1080p'],
    ['video', '--latest', '--quality', '0'],
    ['video', '--latest', '--media-id', 'abc'],
  ];
  for (const args of invalid) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(' '));
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'INVALID_ARGUMENTS');
    assert.notEqual(result.stderr, '');
  }
});

test('all planned commands explicitly report that their actions are not implemented', () => {
  for (const args of [
    ['login'],
    ['logout'],
    ['lessons'],
    ['homework', '--lesson', '13'],
    ['materials', '--lesson-id', '104319'],
    ['sync', '--latest'],
    ['video', '--latest'],
    ['sync', '--lesson', '13', '--video'],
    ['video', '--latest', '--quality', '720', '--media-id', '140777'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 3, args.join(' '));
    assert.equal(JSON.parse(result.stdout).error.code, 'NOT_IMPLEMENTED');
  }
});

test('defaults and materials root stay the same from another working directory', async () => {
  const { parseCommand, MATERIALS_ROOT } = await import('../dist/config.js');
  assert.equal(parseCommand(['lessons']).course, 5467);
  assert.equal(parseCommand(['video', '--latest']).quality, 1080);
  assert.equal(parseCommand(['sync', '--latest']).video, false);
  assert.equal(parseCommand(['sync', '--latest', '--video']).quality, 1080);
  assert.equal(parseCommand(['lessons', '--course=12']).course, 12);
  assert.equal(
    MATERIALS_ROOT,
    fileURLToPath(new URL('../../../course-materials/', import.meta.url)),
  );
  const result = run(['--help'], '/private/tmp');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).data.defaults.materialsRoot, MATERIALS_ROOT);
});
