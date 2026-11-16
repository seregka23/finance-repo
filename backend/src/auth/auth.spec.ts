import { describe, expect, it, beforeAll, vi } from 'vitest';
import { AccessAuthService } from './auth.js';

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const json = (value: object) =>
  encode(new TextEncoder().encode(JSON.stringify(value)));
const teamDomain = 'https://example.cloudflareaccess.com';
const audience = 'application-audience';
let keys: CryptoKeyPair;
let publicKey: JsonWebKey;
beforeAll(async () => {
  keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
});
async function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${json({ alg: 'RS256', kid: 'key-1', ...header })}.${json({ iss: teamDomain, aud: [audience], sub: 'subject', email: 'User@example.com', iat: now - 1, exp: now + 60, ...claims })}`;
  return `${body}.${encode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(body))))}`;
}
function service() {
  return new AccessAuthService({
    teamDomain,
    audience,
    appOrigin: 'https://finance.example.com',
    fetch: async (input) => {
      expect(input).toBe(`${teamDomain}/cdn-cgi/access/certs`);
      return Response.json({
        keys: [{ ...publicKey, kid: 'key-1', alg: 'RS256', use: 'sig' }],
      });
    },
  });
}
describe('Cloudflare Access JWT verification', () => {
  it('accepts a signed application token', async () => {
    await expect(service().verify(await token())).resolves.toEqual({
      subject: JSON.stringify([teamDomain, 'subject']),
      email: 'user@example.com',
    });
  });
  it('rejects invalid claims, algorithm, signature, and oversized tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const value of [
      await token({ iss: 'https://evil.example' }),
      await token({ aud: 'other' }),
      await token({ exp: now - 1 }),
      await token({ iat: now + 60 }),
      await token({ nbf: now + 60 }),
      await token({ email: '' }),
      await token({}, { alg: 'none' }),
      `${await token()}x`,
      'x'.repeat(8193),
    ]) {
      await expect(service().verify(value)).rejects.toMatchObject({
        status: 401,
      });
    }
  });
  it('fails closed when configuration is absent', async () => {
    await expect(
      new AccessAuthService({}).verify('anything'),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('caches trusted keys and rate limits unknown key refreshes', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        keys: [{ ...publicKey, kid: 'key-1', alg: 'RS256', use: 'sig' }],
      }),
    );
    const verifier = new AccessAuthService({
      teamDomain,
      audience,
      appOrigin: 'https://finance.example.com',
      fetch: fetcher,
    });
    const valid = await token();
    const unknown = await token({}, { kid: 'unknown' });
    await verifier.verify(valid);
    await verifier.verify(valid);
    for (let i = 0; i < 10; i++)
      await expect(verifier.verify(unknown)).rejects.toMatchObject({
        status: 401,
      });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    try {
      await expect(verifier.verify(unknown)).rejects.toMatchObject({
        status: 401,
      });
      await expect(verifier.verify(unknown)).rejects.toMatchObject({
        status: 401,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
  it('fails closed on malformed key sets and key fetch timeout', async () => {
    const valid = await token();
    const verifier = new AccessAuthService({
      teamDomain,
      audience,
      appOrigin: 'https://finance.example.com',
      fetch: async () => Response.json({ keys: 'invalid' }),
    });
    await expect(verifier.verify(valid)).rejects.toMatchObject({ status: 401 });
    vi.useFakeTimers();
    try {
      const timeout = new AccessAuthService({
        teamDomain,
        audience,
        appOrigin: 'https://finance.example.com',
        fetch: () => new Promise(() => {}),
      });
      const result = expect(timeout.verify(valid)).rejects.toMatchObject({
        status: 401,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});
