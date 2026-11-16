import {
  ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { Request, Response } from 'express';

@Catch()
@Injectable()
export class ApiErrorFilter extends BaseExceptionFilter {
  constructor(adapter: HttpAdapterHost) {
    super(adapter.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    if (!request.path.toLowerCase().startsWith('/api/v1/')) {
      super.catch(exception, host);
      return;
    }
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const original =
      exception instanceof HttpException ? exception.getResponse() : null;
    const known =
      original !== null &&
      typeof original === 'object' &&
      'error' in original &&
      typeof original.error === 'object';
    const defaults: Record<number, { code: string; message: string }> = {
      400: { code: 'INVALID_INPUT', message: 'Invalid request body' },
      404: { code: 'NOT_FOUND', message: 'Resource not found' },
      413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    };
    // Parser and unexpected errors must not echo submitted tokens or internals.
    const payload = known
      ? original
      : {
          error: defaults[status] ?? {
            code: 'INTERNAL_ERROR',
            message: 'Request could not be completed',
          },
        };
    host
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    host.switchToHttp().getResponse<Response>().status(status).json(payload);
  }
}
