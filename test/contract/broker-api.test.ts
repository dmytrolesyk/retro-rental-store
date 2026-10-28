import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDeployable } from './broker-api';

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
