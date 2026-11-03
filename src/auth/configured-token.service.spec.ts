import { randomBytes, randomUUID } from 'node:crypto';
import { ConfiguredTokenService } from './configured-token.service';
import { parseAuthIdentities } from './auth.config';
import { assertRentalAccess } from './rental-access';
import type { Principal } from './principal';

const token = randomBytes(32).toString('hex');
const client = { id: randomUUID(), role: 'client' as const, renterId: randomUUID() };
const staff = { id: randomUUID(), role: 'staff' as const };

describe('configured token authentication', () => {
  it('resolves an opaque token into a frozen server-defined principal without credentials', () => {
    const service = new ConfiguredTokenService([{ token, ...client }]);
    const principal = service.authenticate(token);
    expect(principal).toEqual(client);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(principal).not.toHaveProperty('token');
    expect(() => service.authenticate(randomBytes(32).toString('hex'))).toThrow('Unauthorized');
  });

  it.each([undefined, null, 123, '', 'short'])(
    'rejects malformed transport credentials',
    credential => {
      const service = new ConfiguredTokenService([{ token, ...client }]);
      expect(() => service.authenticate(credential)).toThrow('Unauthorized');
    },
  );

  it('denies access when no identities are configured', () => {
    const service = new ConfiguredTokenService([]);
    expect(() => service.authenticate(token)).toThrow('Unauthorized');
  });

  it.each([
    'not-json',
    JSON.stringify([
      { token, ...client },
      { token, ...staff },
    ]),
    JSON.stringify([{ token, id: randomUUID(), role: 'client' }]),
    JSON.stringify([{ token, ...staff, renterId: client.renterId }]),
    JSON.stringify([{ token: 'short', ...client }]),
  ])('rejects invalid identity configuration without reflecting its input', raw => {
    let message = '';
    try {
      parseAuthIdentities(raw);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('Invalid AUTH_IDENTITIES configuration');
    expect(message).not.toContain(token);
  });

  it('normalizes UUID case for identity and ownership comparisons', () => {
    expect(
      parseAuthIdentities(
        JSON.stringify([{ token, ...client, renterId: client.renterId.toUpperCase() }]),
      )[0],
    ).toMatchObject(client);
  });
});

describe('rental access policy', () => {
  it('allows clients to read, create and cancel only their own rentals', () => {
    for (const action of ['read', 'create', 'cancel'] as const) {
      expect(() => {
        assertRentalAccess(client, client.renterId, action);
      }).not.toThrow();
      expect(() => {
        assertRentalAccess(client, randomUUID(), action);
      }).toThrow('Forbidden');
    }
  });

  it('reserves issue and return actions for staff, with staff read/cancel access', () => {
    for (const action of ['issue', 'return', 'read', 'cancel'] as const) {
      expect(() => {
        assertRentalAccess(staff, client.renterId, action);
      }).not.toThrow();
    }
    for (const action of ['issue', 'return'] as const) {
      expect(() => {
        assertRentalAccess(client, client.renterId, action);
      }).toThrow('Forbidden');
    }
    expect(() => {
      assertRentalAccess(staff, client.renterId, 'create');
    }).toThrow('Forbidden');
  });

  it('does not turn unknown roles into staff access', () => {
    const forged = { ...staff, role: 'admin' } as unknown as Principal;
    expect(() => {
      assertRentalAccess(forged, client.renterId, 'read');
    }).toThrow('Forbidden');
  });
});
