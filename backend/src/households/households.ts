import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthRequest, Identity } from '../auth/auth.js';
import { apiError, unavailable } from '../auth/auth.js';
import { DATABASE } from '../health.controller.js';

export interface Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
const notFound = () =>
  apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
const ownerRequired = () =>
  apiError(403, 'OWNER_REQUIRED', 'Owner access required');
const invitationInvalid = () =>
  apiError(409, 'INVITATION_INVALID', 'Invitation is invalid or expired');
function dbError(error: unknown): never {
  const s = String(error);
  if (s.includes('category_not_eligible'))
    throw apiError(
      409,
      'CATEGORY_NOT_ELIGIBLE',
      'Category is not eligible for this selection',
    );
  if (s.includes('category_type_immutable'))
    throw apiError(
      409,
      'CATEGORY_TYPE_IMMUTABLE',
      'Category type cannot be changed',
    );
  if (s.includes('household_capacity_exceeded'))
    throw apiError(409, 'HOUSEHOLD_FULL', 'Household is full');
  if (
    s.includes('invitation_invalid') ||
    s.includes('invitation_member_exists') ||
    s.includes('UNIQUE constraint failed: household_invitations')
  )
    throw invitationInvalid();
  if (s.includes('household_access_denied')) throw notFound();
  throw unavailable();
}
function input(body: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw invalid();
  return body as Record<string, unknown>;
}
function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    value.trim().length > 100
  )
    throw invalid();
  return value.trim();
}
function timezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw invalid();
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    throw invalid();
  }
  return value;
}
function email(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
    throw invalid();
  return value.toLowerCase();
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
async function hash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
interface Household {
  id: string;
  name: string;
  baseCurrency: string;
  timeZone: string;
  role: string;
  memberId: string;
}
@Injectable()
export class HouseholdAccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  async get(identity: Identity, id: string): Promise<Household> {
    try {
      const row = await this.db
        .prepare(
          `SELECT h.id, h.name, h.base_currency AS baseCurrency, h.time_zone AS timeZone, m.role, m.id AS memberId FROM households h JOIN household_members m ON m.household_id=h.id WHERE h.id=? AND h.status='active' AND m.identity_subject=? AND m.status='active'`,
        )
        .bind(id, identity.subject)
        .first<Household>();
      if (!row) throw notFound();
      return row;
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
@Injectable()
export class HouseholdGuard implements CanActivate {
  constructor(private readonly access: HouseholdAccessService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const match = /^\/api\/v1\/households\/([^/]+)(?:\/|$)/i.exec(req.path);
    if (match)
      await this.access.get(req.identity, decodeURIComponent(match[1]));
    return true;
  }
}
@Injectable()
export class HouseholdsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: HouseholdAccessService,
  ) {}
  async session(identity: Identity) {
    try {
      const rows = await this.db
        .prepare(
          `SELECT h.id,h.name,h.base_currency AS baseCurrency,h.time_zone AS timeZone,m.role,m.id AS memberId FROM households h JOIN household_members m ON m.household_id=h.id WHERE m.identity_subject=? AND m.status='active' AND h.status='active' ORDER BY h.created_at,h.id`,
        )
        .bind(identity.subject)
        .all<Household>();
      return { user: { email: identity.email }, households: rows.results };
    } catch (e) {
      return dbError(e);
    }
  }
  async create(identity: Identity, body: unknown) {
    const b = input(body, ['name', 'timeZone']);
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
    const b = input(body, ['name', 'timeZone']);
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
    const b = input(body, ['email']);
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
    const b = input(body, ['token']);
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
@Controller('api/v1')
export class HouseholdsController {
  constructor(
    private readonly service: HouseholdsService,
    private readonly access: HouseholdAccessService,
  ) {}
  @Get('session') session(@Req() req: AuthRequest) {
    return this.service.session(req.identity);
  }
  @Post('households') create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.create(req.identity, body);
  }
  @Get('households/:householdId') get(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
  ) {
    return this.access.get(req.identity, id);
  }
  @Patch('households/:householdId') update(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(req.identity, id, body);
  }
  @Get('households/:householdId/members') members(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
  ) {
    return this.service.members(req.identity, id);
  }
  @Post('households/:householdId/invitations') invite(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.invite(req.identity, id, body);
  }
  @Post('invitations/accept') accept(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.accept(req.identity, body);
  }
  @Delete('households/:householdId/invitations/:invitationId')
  @HttpCode(204)
  cancel(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.service.cancel(req.identity, id, invitationId);
  }
  @Delete('households/:householdId/members/:memberId') @HttpCode(204) revoke(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.service.revoke(req.identity, id, memberId);
  }
}
