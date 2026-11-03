import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertDeployable, brokerAuthentication } from './broker-api';

void test('Broker CLI outside Git asks for explicit versions without a raw stack', () => {
  const directory = mkdtempSync(join(tmpdir(), 'broker-no-git-'));
  try {
    const result = spawnSync(process.execPath, [join(__dirname, 'broker-cli.js'), 'can-i-deploy'], {
      cwd: directory,
      env: { PATH: process.env.PATH, PACT_BROKER_URL: 'http://127.0.0.1:9292' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      'Set CONSUMER_VERSION and PROVIDER_VERSION when Git HEAD is unavailable',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('explicit Broker versions work outside Git without invoking a fallback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'broker-no-git-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `console.log(JSON.stringify(require(${JSON.stringify(join(__dirname, 'broker-api.js'))}).brokerConfig()))`,
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          PACT_BROKER_URL: 'http://127.0.0.1:9292',
          CONSUMER_VERSION: 'consumer-release',
          PROVIDER_VERSION: 'provider-release',
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"consumerVersion":"consumer-release"/);
    assert.match(result.stdout, /"providerVersion":"provider-release"/);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('gate accepts only an explicit positive Broker decision', () => {
  assert.doesNotThrow(() => {
    assertDeployable({ summary: { deployable: true } });
  });
  for (const deploymentDecision of [
    { summary: { deployable: false } },
    { summary: { deployable: null, unknown: 1 } },
    { summary: {} },
    {},
    null,
    { summary: { deployable: 'true' } },
  ])
    assert.throws(() => {
      assertDeployable(deploymentDecision);
    });
});

void test('OSS Basic Auth is consistent for HTTP calls and Pact verifier', () => {
  const auth = brokerAuthentication({
    PACT_BROKER_USERNAME: 'ci',
    PACT_BROKER_PASSWORD: 'test-password',
  });
  assert.equal(auth.authorization, `Basic ${Buffer.from('ci:test-password').toString('base64')}`);
  assert.deepEqual(auth.verifierOptions, {
    pactBrokerUsername: 'ci',
    pactBrokerPassword: 'test-password',
  });
});

void test('keeps bearer-token and anonymous local Broker modes', () => {
  const fakeToken = 'test-token';
  const auth = brokerAuthentication({ PACT_BROKER_TOKEN: fakeToken });
  assert.equal(auth.authorization, 'Bearer test-token');
  assert.deepEqual(auth.verifierOptions, { pactBrokerToken: 'test-token' });
  assert.deepEqual(brokerAuthentication({}), { authorization: undefined, verifierOptions: {} });
});

void test('rejects incomplete or ambiguous credentials without exposing secret values', () => {
  const fakeToken = 'private-token';
  for (const environment of [
    { PACT_BROKER_USERNAME: 'ci' },
    { PACT_BROKER_PASSWORD: 'private-password' },
    {
      PACT_BROKER_TOKEN: fakeToken,
      PACT_BROKER_USERNAME: 'ci',
      PACT_BROKER_PASSWORD: 'private-password',
    },
    { PACT_BROKER_USERNAME: 'invalid:username', PACT_BROKER_PASSWORD: 'private-password' },
  ]) {
    assert.throws(
      () => {
        brokerAuthentication(environment);
      },
      error => {
        assert(error instanceof Error);
        assert(!error.message.includes('private-password'));
        assert(!error.message.includes('private-token'));
        return true;
      },
    );
  }
});
