import { createParamDecorator, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ConfiguredTokenService } from './configured-token.service';
import type { Principal } from './principal';

interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly tokens: ConfiguredTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const count = request.rawHeaders
      .filter((_, index) => index % 2 === 0)
      .filter(name => name.toLowerCase() === 'authorization').length;
    const match =
      typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(header) : null;
    if (!match || count !== 1) throw new UnauthorizedException();
    request.principal = this.tokens.authenticate(match[1]);
    return true;
  }
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal) throw new UnauthorizedException();
    return principal;
  },
);
