import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthRequest } from './auth.types.js';
import { apiError } from './auth.errors.js';
import { cookieToken, origin } from './auth.http.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const path = req.path.toLowerCase();
    if (!path.startsWith('/api/v1/')) return true;
    const trustedOrigin = origin(req);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== trustedOrigin.origin
    )
      throw apiError(403, 'INVALID_ORIGIN', 'Invalid request origin');
    if (
      [
        '/api/v1/auth/config',
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
      ].includes(path)
    )
      return true;
    req.identity = await this.auth.verify(cookieToken(req));
    return true;
  }
}
