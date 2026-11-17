import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { DATABASE } from '../health.controller.js';
import type { Database } from '../households/households.js';

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
const invalidCredentials = () =>
  apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
const encoder = new TextEncoder();
const algorithm = 'scrypt-16384-8-5-v1';
const legacyAlgorithm = 'pbkdf2-sha256-600000-v1';
const lifetime = 7 * 24 * 60 * 60;
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(length: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(length)));
}
async function digest(value: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  );
}
async function legacyPasswordHash(
  password: string,
  salt: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bytes = Uint8Array.from(salt.match(/../g) ?? [], (b) =>
    parseInt(b, 16),
  );
  return hex(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations: 600000 },
        key,
        256,
      ),
    ),
  );
}
async function passwordHash(
  password: string,
  salt: string,
  selectedAlgorithm: string,
): Promise<string> {
  try {
    if (selectedAlgorithm === legacyAlgorithm)
      return await legacyPasswordHash(password, salt);
    return scryptSync(password, Buffer.from(salt, 'hex'), 32, {
      N: 16384,
      r: 8,
      p: 5,
      maxmem: 33554432,
    }).toString('hex');
  } catch (error) {
    console.error(
      JSON.stringify({
        stage: 'password_hash',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    throw apiError(503, 'AUTH_UNAVAILABLE', 'Authentication is unavailable');
  }
}
function equal(a: string, b: string): boolean {
  // Password hashes have a fixed public size; compare their bytes in native code.
  return (
    a.length === b.length &&
    timingSafeEqual(encoder.encode(a), encoder.encode(b))
  );
}
function credentials(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw apiError(400, 'INVALID_INPUT', 'Invalid input');
  const b = body as Record<string, unknown>;
  if (
    Object.keys(b).some((k) => k !== 'email' && k !== 'password') ||
    typeof b.email !== 'string' ||
    b.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) ||
    typeof b.password !== 'string' ||
    b.password.length < 12 ||
    b.password.length > 128
  )
    throw apiError(400, 'INVALID_INPUT', 'Invalid input');
  return { email: b.email.toLowerCase(), password: b.password };
}
function cookieToken(req: Request): string {
  const cookies = (req.get('cookie') ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('finance_session='));
  return cookies.length === 1
    ? cookies[0].slice('finance_session='.length)
    : '';
}
function origin(req: Request): URL {
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
interface UserRow {
  id: string;
  email: string;
  password_algorithm: string;
  password_salt: string;
  password_hash: string;
}
@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  async verify(token: string): Promise<Identity> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw unauthenticated();
    try {
      const user = await this.db
        .prepare(
          'SELECT u.id, u.email FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
        )
        .bind(await digest(token), Math.floor(Date.now() / 1000))
        .first<{ id: string; email: string }>();
      if (!user) throw unauthenticated();
      return { subject: `user:${user.id}`, email: user.email };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw unavailable();
    }
  }
  async throttle(email: string, ip: string): Promise<void> {
    if (!ip || ip.length > 128) throw unavailable();
    const now = Math.floor(Date.now() / 1000);
    const keys = [`ip:${await digest(ip)}`, `email:${await digest(email)}`];
    try {
      const update = (key: string) =>
        this.db
          .prepare(
            'INSERT INTO auth_throttles (key, window_start, attempts) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<=? THEN 1 ELSE attempts+1 END, window_start=CASE WHEN window_start<=? THEN ? ELSE window_start END',
          )
          .bind(key, now, now - 900, now - 900, now);
      const results = await this.db.batch([
        ...keys.map(update),
        ...keys.map((key) =>
          this.db
            .prepare('SELECT attempts FROM auth_throttles WHERE key=?')
            .bind(key),
        ),
        this.db
          .prepare(
            'DELETE FROM auth_throttles WHERE key IN (SELECT key FROM auth_throttles WHERE window_start<=? LIMIT 100)',
          )
          .bind(now - 900),
        this.db
          .prepare(
            'DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM auth_sessions WHERE expires_at<=? LIMIT 100)',
          )
          .bind(now),
      ]);
      if (
        results
          .slice(2, 4)
          .some(
            (r, index) =>
              Number(
                (r.results?.[0] as { attempts?: number } | undefined)
                  ?.attempts ?? 999,
              ) > (index === 0 ? 100 : 10),
          )
      )
        throw apiError(429, 'RATE_LIMITED', 'Too many attempts');
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw unavailable();
    }
  }
  async authenticate(
    body: unknown,
    ip: string,
    register: boolean,
  ): Promise<{ email: string; token: string }> {
    let parsed: { email: string; password: string };
    try {
      parsed = credentials(body);
    } catch (error) {
      await this.throttle('', ip);
      throw error;
    }
    const { email, password } = parsed;
    await this.throttle(email, ip);
    try {
      const user = await this.db
        .prepare(
          'SELECT id,email,password_algorithm,password_salt,password_hash FROM auth_users WHERE email=?',
        )
        .bind(email)
        .first<UserRow>();
      const salt =
        register && !user
          ? randomHex(16)
          : (user?.password_salt ?? '00000000000000000000000000000000');
      if (
        !register &&
        user &&
        ![algorithm, legacyAlgorithm].includes(user.password_algorithm)
      )
        throw invalidCredentials();
      const computed = await passwordHash(
        password,
        salt,
        !register && user ? user.password_algorithm : algorithm,
      );
      if (register ? !!user : !user || !equal(computed, user.password_hash))
        throw invalidCredentials();
      const id = register ? crypto.randomUUID() : user!.id;
      const token = randomHex(32);
      const now = Math.floor(Date.now() / 1000);
      const statements = [];
      if (register)
        statements.push(
          this.db
            .prepare(
              'INSERT INTO auth_users (id,email,password_algorithm,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)',
            )
            .bind(id, email, algorithm, salt, computed, now),
        );
      statements.push(
        this.db
          .prepare(
            'INSERT INTO auth_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',
          )
          .bind(await digest(token), id, now + lifetime, now),
      );
      statements.push(
        this.db
          .prepare('DELETE FROM auth_throttles WHERE key=?')
          .bind(`email:${await digest(email)}`),
      );
      await this.db.batch(statements);
      return { email, token };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (String(e).includes('UNIQUE constraint failed: auth_users.email'))
        throw invalidCredentials();
      throw unavailable();
    }
  }
  async logout(token: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    try {
      await this.db
        .prepare('DELETE FROM auth_sessions WHERE token_hash=?')
        .bind(await digest(token))
        .run();
    } catch {
      throw unavailable();
    }
  }
}
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Get('config') config() {
    return { configured: true, signInUrl: null, signOutUrl: null };
  }
  private async signIn(
    body: unknown,
    req: Request,
    res: Response,
    register: boolean,
  ) {
    const result = await this.auth.authenticate(
      body,
      req.get('x-internal-client-ip') ?? '',
      register,
    );
    res.setHeader(
      'Set-Cookie',
      `finance_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${lifetime}${origin(req).protocol === 'https:' ? '; Secure' : ''}`,
    );
    return { user: { email: result.email } };
  }
  @Post('register') register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.signIn(body, req, res, true);
  }
  @Post('login') @HttpCode(200) login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.signIn(body, req, res, false);
  }
  @Post('logout') @HttpCode(204) async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(cookieToken(req));
    res.setHeader(
      'Set-Cookie',
      `finance_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${origin(req).protocol === 'https:' ? '; Secure' : ''}`,
    );
  }
}
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
