import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { WorkspaceController, WorkspaceService } from './workspace.js';
const identity = { subject: 'subject', email: 'member@example.com' };
describe('workspace summary', () => {
  it('reads all counts and active access in one parameterized statement', async () => {
    const counts = {
      accounts: 1,
      transactions: 2,
      plans: 3,
      reserves: 4,
      accountMovements: 5,
    };
    const query = vi.fn().mockResolvedValue([counts]);
    const service = new WorkspaceService({
      $queryRaw: query,
    } as unknown as PrismaService);
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
    const sql = query.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain("m.identity_subject=? AND m.status='active'");
    expect(sql.sql).toContain("h.status='active'");
    expect(sql.values).toEqual(['subject', 'household-1']);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('denies missing or revoked access and hides database errors', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('private'));
    const service = new WorkspaceService({
      $queryRaw: query,
    } as unknown as PrismaService);
    await expect(service.get(identity, 'h')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.get(identity, 'h')).rejects.toMatchObject({
      status: 503,
    });
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
