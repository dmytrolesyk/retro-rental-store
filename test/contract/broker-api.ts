import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { CONSUMER_NAME, PROVIDER_NAME } from './contract.config';

export function brokerConfig() {
  const url = new URL(z.url().parse(process.env.PACT_BROKER_URL));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'PACT_BROKER_URL must be an HTTP(S) URL without credentials, query or fragment',
    );
  const commit = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return {
    url: url.href.replace(/\/$/, ''),
    token: process.env.PACT_BROKER_TOKEN,
    consumerVersion: process.env.CONSUMER_VERSION || commit(),
    providerVersion: process.env.PROVIDER_VERSION || commit(),
  };
}

export function pactPath(consumerVersion: string): string {
  return `/pacts/provider/${encodeURIComponent(PROVIDER_NAME)}/consumer/${encodeURIComponent(CONSUMER_NAME)}/version/${encodeURIComponent(consumerVersion)}`;
}

export async function brokerRequest(path: string, method = 'GET', body?: string): Promise<unknown> {
  const config = brokerConfig();
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      Accept: 'application/hal+json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body,
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(`Pact Broker ${method} failed: HTTP ${String(response.status)}`);
  console.log(`Pact Broker ${method}: HTTP ${String(response.status)}`);
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : undefined;
}

export function assertDeployable(result: unknown): void {
  const { summary } = z
    .object({ summary: z.object({ deployable: z.boolean().nullable() }) })
    .parse(result);
  if (summary.deployable !== true)
    throw new Error('Deployment blocked: summary.deployable is not true');
}
