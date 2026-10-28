import { readFile } from 'node:fs/promises';
import { assertDeployable, brokerConfig, brokerRequest, pactPath } from './broker-api';
import { CONSUMER_NAME, PACT_FILE, PROVIDER_NAME } from './contract.config';

async function main(): Promise<void> {
  const config = brokerConfig();
  switch (process.argv[2]) {
    case 'publish':
      await brokerRequest(
        pactPath(config.consumerVersion),
        'PUT',
        await readFile(PACT_FILE, 'utf8'),
      );
      break;
    case 'tag-provider':
      // Explicit operator action: verification alone must never mark a version as deployed.
      await brokerRequest(
        `/pacticipants/${encodeURIComponent(PROVIDER_NAME)}/versions/${encodeURIComponent(config.providerVersion)}/tags/prod`,
        'PUT',
        '{}',
      );
      break;
    case 'can-i-deploy': {
      const query = new URLSearchParams({
        pacticipant: CONSUMER_NAME,
        version: config.consumerVersion,
        to: 'prod',
      });
      const result = await brokerRequest(`/can-i-deploy?${query}`);
      console.log(JSON.stringify(result, null, 2));
      assertDeployable(result);
      break;
    }
    default:
      throw new Error('Expected publish, tag-provider or can-i-deploy');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
