import { Module } from '@nestjs/common';
import { AUTH_IDENTITIES, parseAuthIdentities } from './auth.config';
import { BearerAuthGuard } from './bearer-auth.guard';
import { ConfiguredTokenService } from './configured-token.service';

@Module({
  providers: [
    {
      provide: AUTH_IDENTITIES,
      // TODO(auth-homework): replace this temporary identity source and ConfiguredTokenService.
      useFactory: () => parseAuthIdentities(process.env.AUTH_IDENTITIES),
    },
    ConfiguredTokenService,
    BearerAuthGuard,
  ],
  exports: [ConfiguredTokenService, BearerAuthGuard],
})
export class AuthModule {}
