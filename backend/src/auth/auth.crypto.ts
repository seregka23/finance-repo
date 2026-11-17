import { scryptSync, timingSafeEqual } from 'node:crypto';
import { apiError } from './auth.errors.js';

const encoder = new TextEncoder();
export const algorithm = 'scrypt-16384-8-5-v1';
export const legacyAlgorithm = 'pbkdf2-sha256-600000-v1';
export const lifetime = 7 * 24 * 60 * 60;
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomHex(length: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(length)));
}
export async function digest(value: string): Promise<string> {
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
export async function passwordHash(
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
export function equal(a: string, b: string): boolean {
  // Password hashes have a fixed public size; compare their bytes in native code.
  return (
    a.length === b.length &&
    timingSafeEqual(encoder.encode(a), encoder.encode(b))
  );
}
