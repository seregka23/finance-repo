import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { FeedbackService } from './feedback.js';
import type { Database } from '../database/database.types.js';
import type { Identity } from '../auth/auth.types.js';
const identity = (subject: string): Identity => ({
  subject,
  email: 'secret@example.invalid',
});
function setup(token: string | null = 'synthetic') {
  const raw = new DatabaseSync(':memory:');
  raw.exec(
    'CREATE TABLE auth_throttles(key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL CHECK(attempts>0))',
  );
  const adapter = {
    prepare(sql: string) {
      let values: (string | number)[] = [];
      return {
        bind(...v: (string | number)[]) {
          values = v;
          return this;
        },
        execute() {
          const stmt = raw.prepare(sql);
          return sql.startsWith('SELECT')
            ? { results: stmt.all(...values) }
            : (stmt.run(...values), { results: [] });
        },
      };
    },
    async batch(s: { execute: () => unknown }[]) {
      raw.exec('BEGIN');
      try {
        const result = s.map((x) => x.execute());
        raw.exec('COMMIT');
        return result;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as Database;
  return { raw, service: new FeedbackService(adapter, token) };
}
const body = {
  title: ' App @mention ',
  message: 'Please fix **this**\n@somebody #12 <b>text</b>',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('feedback', () => {
  it('posts only escaped feedback and returns a locally built link', async () => {
    const { service, raw } = setup();
    try {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ number: 42, html_url: 'https://evil.invalid' }),
            { status: 201 },
          ),
        );
      vi.stubGlobal('fetch', fetch);
      expect(
        await service.submit(identity('user:private-id'), 'ip', body),
      ).toEqual({
        issueNumber: 42,
        issueUrl: 'https://github.com/seregka23/finance-repo/issues/42',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = fetch.mock.calls[0];
      expect(url).toBe(
        'https://api.github.com/repos/seregka23/finance-repo/issues',
      );
      expect(options.redirect).toBe('error');
      expect(options.headers['User-Agent']).toBe('family-finance-feedback');
      const payload = JSON.parse(options.body);
      expect(payload).toEqual({
        title: 'App @\u200bmention',
        body: '    Please fix **this**\n    @\u200bsomebody #12 <b>text</b>',
      });
      expect(options.body).not.toContain('user:private-id');
      expect(options.body).not.toContain('secret@example.invalid');
    } finally {
      raw.close();
    }
  });
  it('rejects malformed input and missing configuration without a network attempt', async () => {
    const { service, raw } = setup(null);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      for (const invalid of [
        { ...body, extra: 'x' },
        { title: 'abcd', message: '0123456789' },
        { title: 'hello', message: 'short' },
        { title: 'line\nbreak', message: '0123456789' },
        null,
      ])
        await expect(
          service.submit(identity('u'), 'ip', invalid),
        ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.submit(identity('u'), 'ip', body),
      ).rejects.toMatchObject({ status: 503 });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      raw.close();
    }
  });
  it('limits each user without consuming global quota on blocked repeats', async () => {
    const { service, raw } = setup();
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('{"number":1}', { status: 201 })),
      );
    vi.stubGlobal('fetch', fetch);
    try {
      for (let n = 0; n < 3; n++)
        await service.submit(identity('u'), 'ip', body);
      for (let n = 0; n < 4; n++)
        await expect(
          service.submit(identity('u'), 'ip', body),
        ).rejects.toMatchObject({ status: 429 });
      await expect(
        service.submit(identity('u'), 'fresh-ip', body),
      ).rejects.toMatchObject({ status: 429 });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(
        raw
          .prepare(
            "SELECT attempts FROM auth_throttles WHERE key='feedback:global'",
          )
          .get()?.attempts,
      ).toBe(3);
      expect(
        raw
          .prepare("SELECT key FROM auth_throttles WHERE key LIKE '%user:u%'")
          .all(),
      ).toHaveLength(0);
    } finally {
      raw.close();
    }
  });
  it('limits a shared network and the overall rate', async () => {
    const { service, raw } = setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response('{"number":1}', { status: 201 })),
        ),
    );
    try {
      for (let n = 0; n < 10; n++)
        await service.submit(identity('net' + n), 'same-ip', body);
      await expect(
        service.submit(identity('blocked'), 'same-ip', body),
      ).rejects.toMatchObject({ status: 429 });
      for (let n = 0; n < 10; n++)
        await service.submit(identity('other' + n), 'ip' + n, body);
      await expect(
        service.submit(identity('over'), 'new-ip', body),
      ).rejects.toMatchObject({ status: 429 });
    } finally {
      raw.close();
    }
  });
  it('fails closed when a throttle counter is missing', async () => {
    const stmt = { bind: () => stmt };
    const db = {
      prepare: () => stmt,
      batch: vi
        .fn()
        .mockResolvedValue([
          {},
          {},
          {},
          { results: [] },
          { results: [] },
          { results: [] },
        ]),
    };
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    await expect(
      new FeedbackService(db as unknown as Database, 'synthetic').submit(
        identity('u'),
        'ip',
        body,
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'FEEDBACK_UNAVAILABLE' } },
    });
    expect(network).not.toHaveBeenCalled();
  });
  it('returns sanitized failure without retry and keeps the quota consumed', async () => {
    const { service, raw } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('sensitive upstream response', { status: 500 }),
      );
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(
        service.submit(identity('u'), 'ip', body),
      ).rejects.toMatchObject({
        status: 502,
        response: { error: { code: 'FEEDBACK_FAILED' } },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        raw
          .prepare(
            "SELECT attempts FROM auth_throttles WHERE key='feedback:global'",
          )
          .get()?.attempts,
      ).toBe(1);
    } finally {
      raw.close();
    }
  });
  it('rejects invalid issue numbers and oversized bodies', async () => {
    const { service, raw } = setup();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"number":0}', { status: 201 }))
      .mockResolvedValueOnce(new Response('x'.repeat(65537), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    try {
      for (let n = 0; n < 2; n++)
        await expect(
          service.submit(identity('u'), 'ip', body),
        ).rejects.toMatchObject({ status: 502 });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      raw.close();
    }
  });
});
