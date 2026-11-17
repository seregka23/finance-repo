import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Identity } from './auth.types.js';
import {
  apiError,
  unauthenticated,
  unavailable,
  invalidCredentials,
} from './auth.errors.js';
import {
  algorithm,
  legacyAlgorithm,
  lifetime,
  randomHex,
  digest,
  passwordHash,
  equal,
} from './auth.crypto.js';

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
interface UserRow {
  id: string;
  email: string;
  passwordAlgorithm: string;
  passwordSalt: string;
  passwordHash: string;
}
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly prisma: PrismaService,
  ) {}
  async verify(token: string): Promise<Identity> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw unauthenticated();
    try {
      const user = await this.prisma.authUser.findFirst({
        where: {
          sessions: {
            some: {
              tokenHash: await digest(token),
              expiresAt: { gt: Math.floor(Date.now() / 1000) },
            },
          },
        },
        select: { id: true, email: true },
      });
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
      const user: UserRow | null = await this.prisma.authUser.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          passwordAlgorithm: true,
          passwordSalt: true,
          passwordHash: true,
        },
      });
      const salt =
        register && !user
          ? randomHex(16)
          : (user?.passwordSalt ?? '00000000000000000000000000000000');
      if (
        !register &&
        user &&
        ![algorithm, legacyAlgorithm].includes(user.passwordAlgorithm)
      )
        throw invalidCredentials();
      const computed = await passwordHash(
        password,
        salt,
        !register && user ? user.passwordAlgorithm : algorithm,
      );
      if (register ? !!user : !user || !equal(computed, user.passwordHash))
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
      await this.prisma.authSession.deleteMany({
        where: { tokenHash: await digest(token) },
      });
    } catch {
      throw unavailable();
    }
  }
}
