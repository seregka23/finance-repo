import type { Request } from 'express';
import { apiError } from './auth.errors.js';

export function cookieToken(req: Request): string {
  const cookies = (req.get('cookie') ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('finance_session='));
  return cookies.length === 1
    ? cookies[0].slice('finance_session='.length)
    : '';
}
export function origin(req: Request): URL {
  try {
    const raw = req.get('x-internal-request-origin') ?? '';
    const value = new URL(raw);
    if (
      value.origin !== raw ||
      !(
        value.protocol === 'https:' ||
        (value.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname))
      )
    )
      throw new Error();
    return value;
  } catch {
    throw apiError(403, 'INVALID_ORIGIN', 'Invalid request origin');
  }
}
