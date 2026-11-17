import { Inject, Injectable } from '@nestjs/common';
import type { Identity } from '../auth/auth.types.js';
import type { Database } from '../database/database.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { DATABASE } from '../database/database.tokens.js';
import { dbError, notFound, ownerRequired } from './households.errors.js';
import type { Household } from './households.types.js';

@Injectable()
export class HouseholdAccessService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly prisma: PrismaService,
  ) {}
  async get(identity: Identity, id: string): Promise<Household> {
    try {
      const row = await this.prisma.householdMember.findFirst({
        where: {
          householdId: id,
          identitySubject: identity.subject,
          status: 'active',
          household: { status: 'active' },
        },
        select: {
          id: true,
          role: true,
          household: {
            select: {
              id: true,
              name: true,
              baseCurrency: true,
              timeZone: true,
            },
          },
        },
      });
      if (!row) throw notFound();
      return { ...row.household, role: row.role, memberId: row.id };
    } catch (e) {
      if (e instanceof Error && 'getStatus' in e) throw e;
      return dbError(e);
    }
  }
  async batch(
    identity: Identity,
    householdId: string,
    requiredRole: 'owner' | 'member',
    statements: D1PreparedStatement[],
  ): Promise<D1Result[]> {
    try {
      // The access assertion and dependent statements must share D1's atomic
      // batch. Prisma's D1 adapter does not support transactions.
      return await this.db.batch([
        this.db
          .prepare(
            'INSERT INTO household_access_checks (household_id, identity_subject, required_role) VALUES (?, ?, ?)',
          )
          .bind(householdId, identity.subject, requiredRole),
        ...statements,
      ]);
    } catch (e) {
      if (String(e).includes('household_access_denied')) {
        const household = await this.get(identity, householdId);
        if (requiredRole === 'owner' && household.role !== 'owner')
          throw ownerRequired();
        throw notFound();
      }
      return dbError(e);
    }
  }
}
