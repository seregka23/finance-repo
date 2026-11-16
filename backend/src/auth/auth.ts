import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export interface AuthConfig {
  teamDomain?: string;
  audience?: string;
  appOrigin?: string;
  fetch?: typeof fetch;
}
export interface Identity {
  subject: string;
  email: string;
}
export type AuthRequest = Request & { identity: Identity };
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
function validConfig(config: AuthConfig): boolean {
  try {
    const team = new URL(config.teamDomain ?? '');
    const origin = new URL(config.appOrigin ?? '');
    return (
      team.protocol === 'https:' &&
      /^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(team.hostname) &&
      team.origin === config.teamDomain &&
      !!config.audience &&
      config.audience.length <= 256 &&
      origin.origin === config.appOrigin &&
      (origin.protocol === 'https:' ||
        (origin.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(origin.hostname)))
    );
  } catch {
    return false;
  }
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const s = atob(
    value.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function json(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(decode(value)),
  );
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid JSON');
  return parsed as Record<string, unknown>;
}
type AccessKey = JsonWebKey & { kid?: string; alg?: string; use?: string };
@Injectable()
export class AccessAuthService {
  private keys: AccessKey[] = [];
  private expiresAt = 0;
  private lastFetchAt = 0;

  private async keyFor(kid: string): Promise<AccessKey> {
    const now = Date.now();
    const find = () =>
      this.keys.find(
        (key) =>
          key.kid === kid &&
          key.kty === 'RSA' &&
          (!key.alg || key.alg === 'RS256') &&
          (!key.use || key.use === 'sig'),
      );
    let key = now < this.expiresAt ? find() : undefined;
    if (key) return key;
    // Set the cooldown before starting I/O. Concurrent requests fail closed rather
    // than sharing an in-flight Worker request's I/O across request contexts.
    if (now - this.lastFetchAt < 30_000)
      throw new Error('Key refresh cooldown');
    this.lastFetchAt = now;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const jwks = await Promise.race([
        (async () => {
          const response = await (this.config.fetch ?? fetch)(
            `${this.config.teamDomain}/cdn-cgi/access/certs`,
            { redirect: 'error', signal: abort.signal },
          );
          if (!response.ok) throw new Error('Key fetch failed');
          const length = Number(response.headers.get('content-length'));
          if (length > 65_536) throw new Error('Key set too large');
          const body = await response.text();
          if (body.length > 65_536) throw new Error('Key set too large');
          return JSON.parse(body) as { keys?: unknown };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error('Key fetch timeout'));
          }, 5_000);
        }),
      ]);
      if (
        !Array.isArray(jwks.keys) ||
        jwks.keys.length > 100 ||
        !jwks.keys.every(
          (k: unknown) =>
            k !== null && typeof k === 'object' && !Array.isArray(k),
        )
      )
        throw new Error('Invalid key set');
      this.keys = jwks.keys as AccessKey[];
      this.expiresAt = Date.now() + 300_000;
      key = find();
      if (!key) throw new Error('Unknown key');
      return key;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  configured(): boolean {
    return validConfig(this.config);
  }
  async verify(token: string): Promise<Identity> {
    if (!this.configured())
      throw apiError(
        503,
        'AUTH_NOT_CONFIGURED',
        'Authentication is not configured',
      );
    try {
      if (token.length > 8192) throw new Error('Token too large');
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Malformed token');
      const header = json(parts[0]);
      const claims = json(parts[1]);
      if (
        header.crit !== undefined ||
        header.alg !== 'RS256' ||
        typeof header.kid !== 'string' ||
        !header.kid ||
        header.kid.length > 256
      )
        throw new Error('Invalid header');
      const now = Math.floor(Date.now() / 1000);
      const aud = claims.aud;
      if (
        claims.iss !== this.config.teamDomain ||
        !(
          aud === this.config.audience ||
          (Array.isArray(aud) && aud.includes(this.config.audience))
        ) ||
        typeof claims.exp !== 'number' ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= now ||
        typeof claims.iat !== 'number' ||
        !Number.isFinite(claims.iat) ||
        claims.iat > now ||
        claims.iat >= claims.exp ||
        (claims.nbf !== undefined &&
          (typeof claims.nbf !== 'number' ||
            !Number.isFinite(claims.nbf) ||
            claims.nbf > now)) ||
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        claims.sub.length > 256 ||
        typeof claims.email !== 'string' ||
        claims.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)
      )
        throw new Error('Invalid claims');
      const key = await this.keyFor(header.kid);
      const imported = await crypto.subtle.importKey(
        'jwk',
        key,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      if (
        !(await crypto.subtle.verify(
          'RSASSA-PKCS1-v1_5',
          imported,
          decode(parts[2]),
          new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        ))
      )
        throw new Error('Invalid signature');
      return {
        subject: JSON.stringify([claims.iss, claims.sub]),
        email: claims.email.toLowerCase(),
      };
    } catch {
      throw unauthenticated();
    }
  }
}
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AccessAuthService,
    @Inject(AUTH_CONFIG) private readonly settings: AuthConfig,
  ) {}
  @Get('config') config() {
    const configured = this.auth.configured();
    return {
      configured,
      signInUrl: configured ? `${this.settings.appOrigin}/` : null,
      signOutUrl: configured
        ? `${this.settings.appOrigin}/cdn-cgi/access/logout`
        : null,
    };
  }
}
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AccessAuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const path = request.path.toLowerCase();
    if (!path.startsWith('/api/v1/') || path === '/api/v1/auth/config')
      return true;
    if (!this.auth.configured())
      throw apiError(
        503,
        'AUTH_NOT_CONFIGURED',
        'Authentication is not configured',
      );
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.get('origin') !== this.config.appOrigin
    )
      throw apiError(403, 'INVALID_ORIGIN', 'Invalid request origin');
    const assertion = request.get('cf-access-jwt-assertion');
    const cookie = request
      .get('cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('CF_Authorization='))
      ?.slice('CF_Authorization='.length);
    request.identity = await this.auth.verify(assertion || cookie || '');
    return true;
  }
}
