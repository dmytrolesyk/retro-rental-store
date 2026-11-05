import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Matchers, Pact, SpecificationVersion } from '@pact-foundation/pact';
import { parse } from 'yaml';
import { RentalsClient } from './consumer/rentals-client';
import {
  CONSUMER_NAME,
  EXAMPLE_RENTAL_ID,
  PACT_DIRECTORY,
  PACT_FILE,
  PROVIDER_NAME,
  RENTAL_EXISTS_STATE,
} from './contract.config';

describe('Rental web client contract', () => {
  beforeAll(async () => {
    // Pact merges existing files; remove this pair's old interactions before generating anew.
    await rm(PACT_FILE, { force: true });
  });

  it('reads the rental through the consumer client and generates a Pact', async () => {
    const renterId = 'f95dbf82-c828-476a-89c4-570b75284ee4';
    const gameCopyId = 'e085647d-b670-4a5d-a55c-fb4228976f08';
    const pact = new Pact({
      consumer: CONSUMER_NAME,
      provider: PROVIDER_NAME,
      dir: PACT_DIRECTORY,
      // V3 HTTP serialization keeps providerStates and interoperates with the course tools.
      spec: SpecificationVersion.SPECIFICATION_VERSION_V3,
      logLevel: 'warn',
    });
    await pact
      .addInteraction()
      .given(RENTAL_EXISTS_STATE, { rentalId: EXAMPLE_RENTAL_ID })
      .uponReceiving('a request to display an existing rental')
      .withRequest('GET', `/rentals/${EXAMPLE_RENTAL_ID}`, builder => {
        builder.headers({ Accept: 'application/json' });
      })
      .willRespondWith(200, builder => {
        builder
          .headers({
            'Content-Type': Matchers.regex('^application/json(;.*)?$', 'application/json'),
          })
          .jsonBody({
            rentalId: EXAMPLE_RENTAL_ID,
            renterId: Matchers.uuid(renterId),
            items: Matchers.eachLike({
              gameCopyId: Matchers.uuid(gameCopyId),
              costPerDay: Matchers.integer(2500),
            }),
          });
      })
      .executeTest(async server => {
        const client = new RentalsClient(server.url);
        await expect(client.getRental(EXAMPLE_RENTAL_ID)).resolves.toEqual({
          rentalId: EXAMPLE_RENTAL_ID,
          renterId,
          items: [{ gameCopyId, costPerDay: 2500 }],
        });
      });

    const generated: unknown = JSON.parse(await readFile(PACT_FILE, 'utf8'));
    expect(generated).toHaveProperty('consumer.name', CONSUMER_NAME);
    expect(generated).toHaveProperty('provider.name', PROVIDER_NAME);
    expect(generated).toHaveProperty('interactions.0.providerStates.0.name', RENTAL_EXISTS_STATE);
  });

  it('agrees with the documented GET rental response for the fields consumed by the client', async () => {
    const spec: unknown = parse(await readFile(resolve('openapi/openapi.yaml'), 'utf8'));
    const operation = ['paths', '/rentals/{rentalId}', 'get'];
    expect(spec).toHaveProperty([...operation, 'operationId'], 'getRental');
    expect(spec).toHaveProperty(
      [...operation, 'responses', '200', 'content', 'application/json', 'schema', '$ref'],
      '#/components/schemas/RentalDetailDto',
    );
    const rental = ['components', 'schemas', 'RentalDetailDto'];
    expect(spec).toHaveProperty(
      [...rental, 'required'],
      expect.arrayContaining(['rentalId', 'renterId', 'items']),
    );
    for (const field of ['rentalId', 'renterId']) {
      expect(spec).toHaveProperty([...rental, 'properties', field, 'type'], 'string');
      expect(spec).toHaveProperty([...rental, 'properties', field, 'format'], 'uuid');
    }
    expect(spec).toHaveProperty([...rental, 'properties', 'items', 'type'], 'array');
    expect(spec).toHaveProperty(
      [...rental, 'properties', 'items', 'items', '$ref'],
      '#/components/schemas/RentalItemDto',
    );
    const item = ['components', 'schemas', 'RentalItemDto'];
    expect(spec).toHaveProperty(
      [...item, 'required'],
      expect.arrayContaining(['gameCopyId', 'costPerDay']),
    );
    expect(spec).toHaveProperty([...item, 'properties', 'gameCopyId', 'type'], 'string');
    expect(spec).toHaveProperty([...item, 'properties', 'gameCopyId', 'format'], 'uuid');
    expect(spec).toHaveProperty([...item, 'properties', 'costPerDay', 'type'], 'integer');
  });
});
