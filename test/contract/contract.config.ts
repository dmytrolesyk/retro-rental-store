import { resolve } from 'node:path';

export const CONSUMER_NAME = 'retro-rental-web';
export const PROVIDER_NAME = 'retro-rental-api';
export const PACT_DIRECTORY = resolve(process.cwd(), 'pacts');
export const PACT_FILE = resolve(PACT_DIRECTORY, `${CONSUMER_NAME}-${PROVIDER_NAME}.json`);
export const RENTAL_EXISTS_STATE = 'a rental with one copy exists';
export const EXAMPLE_RENTAL_ID = '5e651013-72aa-40a3-9fbc-1a24b1c91bad';

// An illustrative contract credential, never configured in the real application.
export const EXAMPLE_AUTH_TOKEN = 'pact-example-credential-for-contract-only';
