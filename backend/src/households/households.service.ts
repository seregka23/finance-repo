import { Inject, Injectable } from '@nestjs/common';
import type { Identity } from '../auth/auth.types.js';
import type { Database } from '../database/database.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { DATABASE } from '../database/database.tokens.js';
import { HouseholdAccessService } from './household-access.service.js';
import {
  dbError,
  invalid,
  invitationInvalid,
  notFound,
  ownerRequired,
} from './households.errors.js';
import { validateRequest } from '../validation/request-dto.js';
import {
  HouseholdDto,
  InviteDto,
  AcceptInvitationDto,
} from './households.dto.js';
import { name, timezone, email } from './households.validation.js';
import { encode, hash } from './households.tokens.js';

@Injectable()
export class HouseholdsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: HouseholdAccessService,
    private readonly prisma: PrismaService,
  ) {}
  async session(identity: Identity) {
    try {
      const rows = await this.prisma.householdMember.findMany({
        where: {
          identitySubject: identity.subject,
          status: 'active',
          household: { status: 'active' },
        },
        orderBy: [{ household: { createdAt: 'asc' } }, { householdId: 'asc' }],
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
      return {
        user: { email: identity.email },
        households: rows.map((row) => ({
          ...row.household,
          role: row.role,
          memberId: row.id,
        })),
      };
    } catch (e) {
      return dbError(e);
    }
  }
  async create(identity: Identity, body: unknown) {
    const b = validateRequest(HouseholdDto, body);
    const n = name(b.name);
    const tz =
      b.timeZone === undefined ? 'Europe/Belgrade' : timezone(b.timeZone);
    const id = crypto.randomUUID(),
      memberId = crypto.randomUUID(),
      now = new Date().toISOString();
    try {
      await this.db.batch([
        this.db
          .prepare(
            'INSERT INTO households (id,name,time_zone,created_at,updated_at) VALUES (?,?,?,?,?)',
          )
          .bind(id, n, tz, now, now),
        this.db
          .prepare(
            "INSERT INTO household_members (id,household_id,identity_subject,email,role,status,created_at,updated_at) VALUES (?,?,?,?,'owner','active',?,?)",
          )
          .bind(memberId, id, identity.subject, identity.email, now, now),
      ]);
    } catch (e) {
      return dbError(e);
    }
    return {
      id,
      name: n,
      baseCurrency: 'RSD',
      timeZone: tz,
      role: 'owner',
      memberId,
    };
  }
  async update(identity: Identity, id: string, body: unknown) {
    const b = validateRequest(HouseholdDto, body);
    if (!Object.keys(b).length) throw invalid();
    const current = await this.access.get(identity, id);
    if (current.role !== 'owner') throw ownerRequired();
    const n = b.name === undefined ? current.name : name(b.name),
      tz = b.timeZone === undefined ? current.timeZone : timezone(b.timeZone);
    await this.access.batch(identity, id, 'owner', [
      this.db
        .prepare(
          'UPDATE households SET name=?,time_zone=?,updated_at=? WHERE id=?',
        )
        .bind(n, tz, new Date().toISOString(), id),
    ]);
    return { ...current, name: n, timeZone: tz };
  }
  async members(identity: Identity, id: string) {
    await this.access.get(identity, id);
    try {
      const [, members, invitations] = await this.access.batch(
        identity,
        id,
        'member',
        [
          this.db
            .prepare(
              "SELECT id,email,role,status FROM household_members WHERE household_id=? AND status='active' ORDER BY created_at,id",
            )
            .bind(id),
          this.db
            .prepare(
              "SELECT id,email,status,expires_at AS expiresAt FROM household_invitations WHERE household_id=? AND status='pending' AND expires_at > unixepoch() ORDER BY created_at,id",
            )
            .bind(id),
        ],
      );
      return {
        members: members.results,
        invitations: invitations.results.map((row) => {
          const invitation = row as { expiresAt: number };
          return {
            ...invitation,
            expiresAt: new Date(invitation.expiresAt * 1000).toISOString(),
          };
        }),
      };
    } catch (e) {
      return dbError(e);
    }
  }
  async invite(identity: Identity, id: string, body: unknown) {
    const b = validateRequest(InviteDto, body);
    const mail = email(b.email);
    const household = await this.access.get(identity, id);
    if (household.role !== 'owner') throw ownerRequired();
    const token = encode(crypto.getRandomValues(new Uint8Array(32))),
      tokenHash = await hash(token),
      invitationId = crypto.randomUUID(),
      now = new Date().toISOString(),
      expiresAt = Math.floor(Date.now() / 1000) + 48 * 3600;
    await this.access.batch(identity, id, 'owner', [
      this.db
        .prepare(
          "UPDATE household_invitations SET status='revoked',updated_at=? WHERE household_id=? AND status='pending' AND expires_at<=unixepoch()",
        )
        .bind(now, id),
      this.db
        .prepare(
          "INSERT INTO household_invitations (id,household_id,email,token_hash,status,expires_at,created_by_member_id,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?,?,?)",
        )
        .bind(
          invitationId,
          id,
          mail,
          tokenHash,
          expiresAt,
          household.memberId,
          now,
          now,
        ),
    ]);
    return {
      id: invitationId,
      email: mail,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      token,
    };
  }
  async accept(identity: Identity, body: unknown) {
    const b = validateRequest(AcceptInvitationDto, body);
    if (typeof b.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.token))
      throw invitationInvalid();
    const tokenHash = await hash(b.token),
      now = new Date().toISOString(),
      memberId = crypto.randomUUID();
    try {
      const result = await this.db.batch([
        this.db
          .prepare(
            'INSERT INTO invitation_acceptance_checks (token_hash,email) VALUES (?,?)',
          )
          .bind(tokenHash, identity.email),
        this.db
          .prepare(
            "UPDATE household_invitations SET status='accepted',updated_at=? WHERE token_hash=? AND email=? AND status='pending' AND expires_at>unixepoch()",
          )
          .bind(now, tokenHash, identity.email),
        this.db
          .prepare(
            "INSERT INTO household_members (id,household_id,identity_subject,email,role,status,created_at,updated_at) SELECT ?,household_id,?,?,'member','active',?,? FROM household_invitations WHERE token_hash=? ON CONFLICT(household_id,identity_subject) DO UPDATE SET email=excluded.email,status='active',updated_at=excluded.updated_at",
          )
          .bind(
            memberId,
            identity.subject,
            identity.email,
            now,
            now,
            tokenHash,
          ),
        this.db
          .prepare(
            'UPDATE household_invitations SET accepted_by_member_id=(SELECT id FROM household_members WHERE household_id=household_invitations.household_id AND identity_subject=?) WHERE token_hash=?',
          )
          .bind(identity.subject, tokenHash),
        this.db
          .prepare(
            'SELECT household_id AS id FROM household_invitations WHERE token_hash=?',
          )
          .bind(tokenHash),
      ]);
      const id = (result[4].results[0] as { id: string }).id;
      return this.access.get(identity, id);
    } catch (e) {
      if (e instanceof Error && 'getStatus' in e) throw e;
      return dbError(e);
    }
  }
  async cancel(identity: Identity, id: string, invitationId: string) {
    const h = await this.access.get(identity, id);
    if (h.role !== 'owner') throw ownerRequired();
    const result = await this.access.batch(identity, id, 'owner', [
      this.db
        .prepare(
          "UPDATE household_invitations SET status='revoked',updated_at=? WHERE household_id=? AND id=? AND status='pending'",
        )
        .bind(new Date().toISOString(), id, invitationId),
    ]);
    if (!result[1].meta.changes) throw notFound();
  }
  async revoke(identity: Identity, id: string, memberId: string) {
    const h = await this.access.get(identity, id);
    if (h.role !== 'owner') throw ownerRequired();
    if (h.memberId === memberId) throw ownerRequired();
    const result = await this.access.batch(identity, id, 'owner', [
      this.db
        .prepare(
          "UPDATE household_members SET status='revoked',updated_at=? WHERE household_id=? AND id=? AND status='active' AND role<>'owner'",
        )
        .bind(new Date().toISOString(), id, memberId),
    ]);
    if (!result[1].meta.changes) throw notFound();
  }
}
