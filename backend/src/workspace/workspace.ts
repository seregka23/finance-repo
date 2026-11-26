import { Controller, Get, Injectable, Param } from '@nestjs/common';
import type { Identity } from '../auth/auth.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { dbError, notFound } from '../households/households.errors.js';

interface WorkspaceCounts {
  accounts: number;
  transactions: number;
  plans: number;
  reserves: number;
  accountMovements: number;
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async get(identity: Identity, householdId: string) {
    let counts: WorkspaceCounts;
    try {
      const rows = await this.prisma.$queryRaw<WorkspaceCounts[]>(Prisma.sql`
        SELECT (SELECT COUNT(*) FROM accounts WHERE household_id=h.id) AS accounts,
          (SELECT COUNT(*) FROM transactions WHERE household_id=h.id) AS transactions,
          (SELECT COUNT(*) FROM monthly_plans WHERE household_id=h.id) AS plans,
          (SELECT COUNT(*) FROM reserves WHERE household_id=h.id) AS reserves,
          (SELECT COUNT(*) FROM account_movements WHERE household_id=h.id) AS accountMovements
        FROM households h JOIN household_members m ON m.household_id=h.id
          AND m.identity_subject=${identity.subject} AND m.status='active'
        WHERE h.id=${householdId} AND h.status='active'`);
      if (!rows.length) throw notFound();
      const row = rows[0];
      counts = {
        accounts: Number(row.accounts),
        transactions: Number(row.transactions),
        plans: Number(row.plans),
        reserves: Number(row.reserves),
        accountMovements: Number(row.accountMovements),
      };
    } catch (e) {
      if (e instanceof Error && 'getStatus' in e) throw e;
      return dbError(e);
    }
    return {
      counts,
      capabilities: {
        accounts: true,
        transactions: true,
        imports: false,
        budgets: true,
        reserves: true,
        reports: true,
      },
    };
  }
}

@Controller('api/v1/households/:householdId/workspace')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Get()
  get(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') householdId: string,
  ) {
    return this.service.get(identity, householdId);
  }
}
