import { createHash } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AUTH_IDENTITIES, parseAuthIdentities } from './auth.config';
import type { Principal } from './principal';

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * TEMPORARY (HW18): authenticates manually configured opaque tokens.
 * TODO(auth-homework): replace this credential lookup with the course's actual
 * authentication implementation. Keep the verified Principal boundary and
 * rental access rules; do not carry AUTH_IDENTITIES into the final login flow.
 */
@Injectable()
export class ConfiguredTokenService {
  private readonly principalsByTokenDigest = new Map<string, Principal>();

  constructor(@Inject(AUTH_IDENTITIES) identities: unknown) {
    for (const { token, ...principal } of parseAuthIdentities(identities)) {
      this.principalsByTokenDigest.set(digest(token), Object.freeze(principal));
    }
  }

  authenticate(token: unknown): Principal {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token))
      throw new UnauthorizedException();
    const principal = this.principalsByTokenDigest.get(digest(token));
    if (!principal) throw new UnauthorizedException();
    return principal;
  }
}
