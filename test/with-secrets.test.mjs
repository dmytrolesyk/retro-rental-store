import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const temporary = mkdtempSync(join(tmpdir(), 'with-secrets-test-'));
const fakeInfisical = join(temporary, 'infisical');
writeFileSync(
  fakeInfisical,
  `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`,
  { mode: 0o755 },
);
after(() => rmSync(temporary, { recursive: true, force: true }));
const wrapper = fileURLToPath(new URL('../scripts/with-secrets.sh', import.meta.url));
const environment = { ...process.env, PATH: `${temporary}:${process.env.PATH}` };

test('SKIP_VAULT uses the command directly, preserving arguments and DB settings', () => {
  const args = ['two words', 'literal $(must-not-run)'];
  const result = spawnSync(
    'bash',
    [
      wrapper,
      'dev',
      process.execPath,
      '-e',
      'console.log(JSON.stringify({args:process.argv.slice(1),database:process.env.DB_NAME}))',
      ...args,
    ],
    {
      env: { ...environment, SKIP_VAULT: '1', DB_NAME: 'wrapper_test' },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args, database: 'wrapper_test' });
});

test('propagates the command exit code and rejects missing command arguments', () => {
  const failed = spawnSync('bash', [wrapper, 'dev', process.execPath, '-e', 'process.exit(7)'], {
    env: { ...environment, SKIP_VAULT: '1' },
    encoding: 'utf8',
  });
  assert.equal(failed.status, 7);
  const missing = spawnSync('bash', [wrapper, 'dev'], { env: environment, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Usage:/);
});

test('delegates environment and command arguments to Infisical when bypass is disabled', () => {
  const result = spawnSync('bash', [wrapper, 'dev', 'node', 'script.js', 'two words'], {
    env: { ...environment, SKIP_VAULT: '0' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    'run',
    '--env=dev',
    '--',
    'node',
    'script.js',
    'two words',
  ]);
});
