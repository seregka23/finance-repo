import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthRequest, Identity } from './auth.types.js';

export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Identity =>
    context.switchToHttp().getRequest<AuthRequest>().identity,
);
