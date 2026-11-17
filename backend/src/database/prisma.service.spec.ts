import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from './prisma.service.js';

describe('Prisma D1 transaction boundary', () => {
  it('rejects batch transactions before executing database operations', () => {
    const prepare = vi.fn();
    const client = new PrismaService({ prepare } as unknown as D1Database);
    expect(() => client.$transaction([])).toThrow(/atomic D1 batch/);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects interactive transactions without invoking their callback', () => {
    const callback = vi.fn();
    const client = new PrismaService({} as D1Database);
    expect(() => client.$transaction(callback)).toThrow(/atomic D1 batch/);
    expect(callback).not.toHaveBeenCalled();
  });
});
