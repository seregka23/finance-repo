import { HttpException } from '@nestjs/common';

export function apiError(
  status: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ error: { code, message } }, status);
}
export const unauthenticated = () =>
  apiError(401, 'UNAUTHENTICATED', 'Authentication required');
export const unavailable = () =>
  apiError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable');
export const invalidCredentials = () =>
  apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
