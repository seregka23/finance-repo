import { describe, expect, it, vi } from 'vitest';
import { CategoryService } from './categories.js';
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
  const service = new CategoryService(
    { prepare } as unknown as Database,
    { batch } as unknown as HouseholdAccessService,
  );
  return { service, statements, batch };
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
  it('filters eligible options by active status, type and household, and makes transfer empty', async () => {
    const { service, statements } = setup();
    for (const [usage, type] of [
      ['fee', 'expense'],
      ['refund', 'expense'],
      ['budget', 'expense'],
      ['income', 'income'],
      ['transfer', null],
    ] as const) {
      await service.options(identity, 'h1', { usage });
      const statement = statements.at(-1)!;
      expect(statement.sql).toContain(
        "household_id=? AND status='active' AND type=?",
      );
      expect(statement.values).toEqual(['h1', type]);
    }
    await expect(service.options(identity, 'h1', {})).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.list(identity, 'h1', { status: 'bogus' }),
    ).rejects.toMatchObject({ status: 400 });
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
