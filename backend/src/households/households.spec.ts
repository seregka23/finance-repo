import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import {
  HouseholdAccessService,
  HouseholdsService,
  type Database,
} from './households.js';

const identity = { subject: 'subject', email: 'member@example.com' };
const member = {
  id: 'member',
  role: 'owner',
  household: {
    id: 'home',
    name: 'Home',
    baseCurrency: 'RSD',
    timeZone: 'Europe/Belgrade',
  },
};

describe('household access reads', () => {
  it('scopes access to the active member and household', async () => {
    const findFirst = vi.fn().mockResolvedValue(member);
    const prisma = {
      householdMember: { findFirst },
    } as unknown as PrismaService;
    const access = new HouseholdAccessService({} as Database, prisma);
    await expect(access.get(identity, 'home')).resolves.toEqual({
      ...member.household,
      role: 'owner',
      memberId: 'member',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId: 'home',
          identitySubject: 'subject',
          status: 'active',
          household: { status: 'active' },
        },
      }),
    );
    findFirst.mockResolvedValue(null);
    await expect(access.get(identity, 'home')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns only active memberships in household creation order', async () => {
    const findMany = vi.fn().mockResolvedValue([member]);
    const prisma = {
      householdMember: { findMany },
    } as unknown as PrismaService;
    const service = new HouseholdsService(
      {} as Database,
      {} as HouseholdAccessService,
      prisma,
    );
    await expect(service.session(identity)).resolves.toEqual({
      user: { email: identity.email },
      households: [{ ...member.household, role: 'owner', memberId: 'member' }],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          identitySubject: 'subject',
          status: 'active',
          household: { status: 'active' },
        },
        orderBy: [{ household: { createdAt: 'asc' } }, { householdId: 'asc' }],
      }),
    );
  });
  it('reads members and unexpired invitations in one authorized statement', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        {
          members:
            '[{"id":"m","email":null,"role":"member","status":"active"}]',
          invitations:
            '[{"id":"i","email":"a@example.com","status":"pending","expiresAt":100}]',
        },
      ]);
    const service = new HouseholdsService(
      {} as Database,
      {} as HouseholdAccessService,
      { $queryRaw: query } as unknown as PrismaService,
    );
    await expect(service.members(identity, 'home')).resolves.toEqual({
      members: [{ id: 'm', email: null, role: 'member', status: 'active' }],
      invitations: [
        {
          id: 'i',
          email: 'a@example.com',
          status: 'pending',
          expiresAt: '1970-01-01T00:01:40.000Z',
        },
      ],
    });
    const sql = query.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain(
      "requester.identity_subject=? AND requester.status='active'",
    );
    expect(sql.values).toEqual(['subject', 'home']);
    query.mockResolvedValueOnce([]);
    await expect(service.members(identity, 'home')).rejects.toMatchObject({
      status: 404,
    });
  });
});
