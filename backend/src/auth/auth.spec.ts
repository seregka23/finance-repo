import { describe, expect, it, vi } from 'vitest';
import { pbkdf2Sync, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AuthService, ApiAuthGuard } from './auth.js';
import type { Database } from '../households/households.js';
import type { ExecutionContext } from '@nestjs/common';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(
    readFileSync(
      new URL('../../migrations/0005_native_auth.sql', import.meta.url),
      'utf8',
    ),
  );
  function prepare(sql: string) {
    let values: (string | number)[] = [];
    return {
      bind(...args: (string | number)[]) {
        values = args;
        return this;
      },
      async first() {
        return db.prepare(sql).get(...values) ?? null;
      },
      async run() {
        db.prepare(sql).run(...values);
        return { results: [] };
      },
      execute() {
        const stmt = db.prepare(sql);
        return sql.startsWith('SELECT')
          ? { results: stmt.all(...values) }
          : (stmt.run(...values), { results: [] });
      },
    };
  }
  return {
    raw: db,
    adapter: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        db.exec('BEGIN');
        try {
          const results = statements.map((s) => s.execute());
          db.exec('COMMIT');
          return results;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    } as unknown as Database,
  };
}

describe('native authentication', () => {
  it('registers and logs in with a hashed password and revocable opaque session', async () => {
    const { adapter, raw } = database();
    const auth = new AuthService(adapter);
    const registration = await auth.authenticate(
      { email: 'User@example.com', password: 'correct horse battery' },
      '127.0.0.1',
      true,
    );
    expect(registration.email).toBe('user@example.com');
    expect(await auth.verify(registration.token)).toMatchObject({
      email: 'user@example.com',
      subject: expect.stringMatching(/^user:/),
    });
    const row = raw.prepare('SELECT * FROM auth_users').get()!;
    expect(row.password_algorithm).toBe('scrypt-16384-8-5-v1');
    expect(row.password_hash).toBe(
      scryptSync(
        'correct horse battery',
        Buffer.from(row.password_salt as string, 'hex'),
        32,
        { N: 16384, r: 8, p: 5, maxmem: 33554432 },
      ).toString('hex'),
    );
    expect(row.password_hash).not.toContain('correct horse battery');
    expect(
      raw.prepare('SELECT token_hash FROM auth_sessions').get()!.token_hash,
    ).not.toBe(registration.token);
    await expect(
      auth.authenticate(
        { email: 'user@example.com', password: 'incorrect password' },
        '127.0.0.1',
        false,
      ),
    ).rejects.toMatchObject({ status: 401 });
    const login = await auth.authenticate(
      { email: 'user@example.com', password: 'correct horse battery' },
      '127.0.0.1',
      false,
    );
    await auth.logout(login.token);
    await expect(auth.verify(login.token)).rejects.toMatchObject({
      status: 401,
    });
    expect(await auth.verify(registration.token)).toBeTruthy();
    raw.prepare('UPDATE auth_sessions SET expires_at=1').run();
    await expect(auth.verify(registration.token)).rejects.toMatchObject({
      status: 401,
    });
  }, 15000);
  it('verifies the deployed scrypt vector', async () => {
    const { adapter, raw } = database();
    raw
      .prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?)')
      .run(
        'vector',
        'vector@example.com',
        'scrypt-16384-8-5-v1',
        '07'.repeat(16),
        '65a782e7470205259892530b36ca2821766311cb1a8b82f565756297cdf12f8a',
        1,
      );
    const result = await new AuthService(adapter).authenticate(
      { email: 'vector@example.com', password: 'synthetic-runtime-probe' },
      'ip',
      false,
    );
    expect(result.email).toBe('vector@example.com');
  });
  it('verifies legacy PBKDF2 and reports unsupported runtime hashing separately', async () => {
    const { adapter, raw } = database();
    const salt = '01'.repeat(16);
    const hash = pbkdf2Sync(
      'correct horse battery',
      Buffer.from(salt, 'hex'),
      600000,
      32,
      'sha256',
    ).toString('hex');
    raw
      .prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?)')
      .run(
        'legacy',
        'legacy@example.com',
        'pbkdf2-sha256-600000-v1',
        salt,
        hash,
        1,
      );
    const auth = new AuthService(adapter);
    await expect(
      auth.authenticate(
        { email: 'legacy@example.com', password: 'correct horse battery' },
        'ip',
        false,
      ),
    ).resolves.toMatchObject({ email: 'legacy@example.com' });
    const spy = vi
      .spyOn(crypto.subtle, 'deriveBits')
      .mockRejectedValueOnce(
        new DOMException('sensitive details', 'NotSupportedError'),
      );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        auth.authenticate(
          { email: 'legacy@example.com', password: 'correct horse battery' },
          'ip',
          false,
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: { error: { code: 'AUTH_UNAVAILABLE' } },
      });
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({
          stage: 'password_hash',
          errorName: 'NotSupportedError',
        }),
      );
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  }, 15000);
  it('rejects unknown stored algorithms as invalid credentials', async () => {
    const { adapter, raw } = database();
    raw
      .prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?)')
      .run(
        'unknown',
        'unknown@example.com',
        'unknown',
        '00'.repeat(16),
        '00'.repeat(32),
        1,
      );
    await expect(
      new AuthService(adapter).authenticate(
        { email: 'unknown@example.com', password: 'correct horse battery' },
        'ip',
        false,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('limits attempts by IP even across random emails', async () => {
    const { adapter } = database();
    const auth = new AuthService(adapter);
    for (let i = 0; i < 100; i++)
      await auth.throttle(`user${i}@example.com`, '127.0.0.1');
    await expect(
      auth.throttle('new@example.com', '127.0.0.1'),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('limits a single email across networks and clears its counter on success', async () => {
    const { adapter, raw } = database();
    const auth = new AuthService(adapter);
    await auth.authenticate(
      { email: 'user@example.com', password: 'correct horse battery' },
      'register-ip',
      true,
    );
    for (let i = 0; i < 9; i++)
      await auth.throttle('user@example.com', `ip-${i}`);
    await auth.authenticate(
      { email: 'user@example.com', password: 'correct horse battery' },
      'valid-ip',
      false,
    );
    const count = raw
      .prepare(
        "SELECT count(*) AS count FROM auth_throttles WHERE key LIKE 'email:%'",
      )
      .get()!.count;
    expect(count).toBe(0);
    for (let i = 0; i < 10; i++)
      await auth.throttle('user@example.com', `other-ip-${i}`);
    await expect(
      auth.throttle('user@example.com', 'other-ip-10'),
    ).rejects.toMatchObject({ status: 429 });
  }, 15000);
  it('requires the trusted origin for public writes', async () => {
    const { adapter } = database();
    const guard = new ApiAuthGuard(new AuthService(adapter));
    const request = {
      path: '/api/v1/auth/register',
      method: 'POST',
      get: (key: string) =>
        (
          ({
            origin: 'https://attacker.test',
            'x-internal-request-origin': 'https://app.test',
          }) as Record<string, string>
        )[key],
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
    });
  });
});
