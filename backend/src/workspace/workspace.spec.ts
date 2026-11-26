import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../households/households.js';
import { HouseholdAccessService } from '../households/households.js';
import { WorkspaceController, WorkspaceService } from './workspace.js';

const identity = { subject: 'subject', email: 'member@example.com' };

describe('workspace summary', () => {
  it('binds every count to the household and authorizes the read in the batch', async () => {
    const counts = {
      accounts: 1,
      transactions: 2,
      plans: 3,
      reserves: 4,
      accountMovements: 5,
    };
    const statement = { bind: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const prepare = vi.fn().mockReturnValue(statement);
    const batch = vi.fn().mockResolvedValue([{}, { results: [counts] }]);
    const service = new WorkspaceService(
      { prepare } as unknown as Database,
      { batch } as unknown as HouseholdAccessService,
    );

    await expect(service.get(identity, 'household-1')).resolves.toEqual({
      counts,
      capabilities: {
        accounts: true,
        transactions: true,
        imports: false,
        budgets: true,
        reserves: true,
        reports: true,
      },
    });
    const sql = prepare.mock.calls[0][0] as string;
    for (const table of [
      'accounts',
      'transactions',
      'monthly_plans',
      'reserves',
      'account_movements',
    ]) {
      expect(sql).toContain(`FROM ${table} WHERE household_id=?`);
    }
    expect(statement.bind).toHaveBeenCalledWith(
      ...Array(5).fill('household-1'),
    );
    expect(batch).toHaveBeenCalledWith(identity, 'household-1', 'member', [
      statement,
    ]);
  });

  it('propagates access and database failures without returning a summary', async () => {
    const error = new Error('access denied');
    const statement = { bind: vi.fn().mockReturnThis() };
    const service = new WorkspaceService(
      { prepare: vi.fn().mockReturnValue(statement) } as unknown as Database,
      {
        batch: vi.fn().mockRejectedValue(error),
      } as unknown as HouseholdAccessService,
    );
    await expect(service.get(identity, 'household-1')).rejects.toBe(error);
  });

  it('passes the authenticated identity and route household to the service', async () => {
    const get = vi.fn().mockResolvedValue({ counts: {} });
    const controller = new WorkspaceController({
      get,
    } as unknown as WorkspaceService);
    await controller.get(identity, 'household-1');
    expect(get).toHaveBeenCalledWith(identity, 'household-1');
  });
});
