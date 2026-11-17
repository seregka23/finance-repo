import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types.js';
import { HouseholdAccessService } from './household-access.service.js';

@Injectable()
export class HouseholdGuard implements CanActivate {
  constructor(private readonly access: HouseholdAccessService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const match = /^\/api\/v1\/households\/([^/]+)(?:\/|$)/i.exec(req.path);
    if (match)
      await this.access.get(req.identity, decodeURIComponent(match[1]));
    return true;
  }
}
