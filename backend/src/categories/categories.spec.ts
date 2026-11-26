import { describe, expect, it, vi } from 'vitest';
import { CategoryService } from './categories.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { Database } from '../households/households.js';
import type { HouseholdAccessService } from '../households/households.js';

const identity = { subject: 'member', email: 'member@example.com' };
function setup(rows: unknown[] = []) {
  const statements: {
    sql: string;
    values: unknown[];
    bind: (...args: unknown[]) => unknown;
  }[] = [];
  const prepare = vi.fn((sql: string) => {
    const statement = {
      sql,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        this.values = values;
        return this;
      },
    };
    statements.push(statement);
    return statement;
  });
  const batch = vi.fn().mockResolvedValue([{}, { results: rows }]);
  const queryRaw = vi.fn().mockResolvedValue([{ id: null }]);
  const service = new CategoryService(
    { prepare } as unknown as Database,
    { batch } as unknown as HouseholdAccessService,
    { $queryRaw: queryRaw } as unknown as PrismaService,
  );
  return { service, statements, batch, queryRaw };
}

describe('categories', () => {
  it('creates a trimmed category in the member-authorized household without a name uniqueness check', async () => {
    const { service, statements, batch } = setup();
    const result = await service.create(identity, 'h1', {
      name: ' Food ',
      type: 'expense',
    });
    expect(result).toMatchObject({
      name: 'Food',
      type: 'expense',
      status: 'active',
    });
    expect(statements[0].values).toEqual([
      result.id,
      'h1',
      'Food',
      'expense',
      'active',
      result.createdAt,
      result.updatedAt,
    ]);
    expect(batch).toHaveBeenCalledWith(identity, 'h1', 'member', [
      statements[0],
    ]);
  });
  it('scopes update and returns 404 on a missing or cross-household target', async () => {
    const { service, statements } = setup();
    await expect(
      service.update(identity, 'h1', 'other-id', { status: 'archived' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(statements[0].sql).toContain('WHERE household_id=? AND id=?');
    expect(statements[0].values.slice(-2)).toEqual(['h1', 'other-id']);
  });
  it('rejects malformed bodies and immutable type updates before any database call', async () => {
    const { service, batch } = setup();
    for (const body of [
      null,
      [],
      {},
      { type: 'income' },
      { name: '  ' },
      { name: 'x', extra: 1 },
      { status: null },
      { name: 'x'.repeat(81) },
    ]) {
      await expect(
        service.update(identity, 'h1', 'id', body),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(batch).not.toHaveBeenCalled();
  });
  it('scopes options and distinguishes denied access from an authorized empty list', async () => {
    const { service, queryRaw } = setup();
    for (const [usage, type] of [
      ['fee', 'expense'],
      ['refund', 'expense'],
      ['budget', 'expense'],
      ['income', 'income'],
      ['transfer', 'transfer'],
    ] as const) {
      await expect(service.options(identity, 'h1', { usage })).resolves.toEqual(
        { usage, categories: [] },
      );
      const sql = queryRaw.mock.calls.at(-1)![0] as {
        sql: string;
        values: unknown[];
      };
      expect(sql.sql).toContain("m.identity_subject=? AND m.status='active'");
      expect(sql.values).toEqual([
        identity.subject,
        'active',
        'active',
        type,
        type,
        null,
        null,
        'h1',
      ]);
    }
    queryRaw.mockResolvedValueOnce([]);
    await expect(service.list(identity, 'h1', {})).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'HOUSEHOLD_NOT_FOUND' } },
    });
    await expect(service.get(identity, 'h1', 'absent')).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'CATEGORY_NOT_FOUND' } },
    });
    await expect(service.options(identity, 'h1', {})).rejects.toMatchObject({
      status: 400,
    });
  });
  it('provides a parameterized selection assertion for the same atomic batch as a future write', () => {
    const { service, statements } = setup();
    expect(service.selectionStatement('h1', 'c1', 'expense')).toBe(
      statements[0],
    );
    expect(statements[0].sql).toContain(
      'INSERT INTO category_selection_checks',
    );
    expect(statements[0].values).toEqual(['h1', 'c1', 'expense']);
  });
});
