import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDeployable, brokerAuthentication } from './broker-api';

void test('gate accepts only an explicit positive Broker decision', () => {
  assert.doesNotThrow(() => {
    assertDeployable({ summary: { deployable: true } });
  });
  for (const result of [
    { summary: { deployable: false } },
    { summary: { deployable: null, unknown: 1 } },
    { summary: {} },
    {},
    null,
    { summary: { deployable: 'true' } },
  ])
    assert.throws(() => {
      assertDeployable(result);
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
