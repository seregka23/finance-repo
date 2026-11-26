import {
  Body,
  Controller,
  HttpException,
  Inject,
  Injectable,
  Post,
  Req,
} from '@nestjs/common';
import { apiError } from '../auth/auth.errors.js';
import { digest } from '../auth/auth.crypto.js';
import type { AuthRequest, Identity } from '../auth/auth.types.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { readProviderBody } from '../finance/provider-transport.js';

export const FEEDBACK_TOKEN = Symbol('FEEDBACK_TOKEN');
const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
const unavailable = () =>
  apiError(
    503,
    'FEEDBACK_UNAVAILABLE',
    'Feedback is not configured or temporarily unavailable',
  );
const failed = () =>
  apiError(
    502,
    'FEEDBACK_FAILED',
    'Feedback could not be delivered; check before retrying',
  );
const limit = () =>
  apiError(429, 'RATE_LIMITED', 'Too many feedback submissions; try later');
function hasControl(value: string, multiline: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code === 127 ||
      (code < 32 && !(multiline && [9, 10, 13].includes(code)))
    )
      return true;
  }
  return false;
}
function validate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).length !== 2 ||
    Object.keys(b).some((k) => k !== 'title' && k !== 'message') ||
    typeof b.title !== 'string' ||
    typeof b.message !== 'string'
  )
    throw invalid();
  const title = b.title.trim(),
    message = b.message.trim();
  if (
    title.length < 5 ||
    title.length > 100 ||
    message.length < 10 ||
    message.length > 2000 ||
    hasControl(title, false) ||
    hasControl(message, true)
  )
    throw invalid();
  return { title, message };
}
function plain(value: string) {
  return value.replaceAll('@', '@\u200b');
}
@Injectable()
export class FeedbackService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FEEDBACK_TOKEN) private readonly token: string | null,
  ) {}
  private async throttle(identity: Identity, ip: string) {
    if (!ip || ip.length > 128) throw unavailable();
    const now = Math.floor(Date.now() / 1000),
      cutoff = now - 900;
    const user = `feedback:user:${await digest(identity.subject)}`,
      network = `feedback:ip:${await digest(ip)}`,
      global = 'feedback:global';
    const sql = (guard: string) =>
      `INSERT INTO auth_throttles(key,window_start,attempts) SELECT ?,?,1 WHERE ${guard} ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<=? THEN 1 ELSE MIN(attempts+1,?) END,window_start=CASE WHEN window_start<=? THEN ? ELSE window_start END`;
    const update = (
      key: string,
      max: number,
      guard: string,
      guardKeys: string[],
    ) =>
      this.db
        .prepare(sql(guard))
        .bind(key, now, ...guardKeys, cutoff, max + 1, cutoff, now);
    const userOk = '(SELECT attempts FROM auth_throttles WHERE key=?)<=3';
    const ipOk = '(SELECT attempts FROM auth_throttles WHERE key=?)<=10';
    try {
      const result = await this.db.batch([
        update(user, 3, '1', []),
        update(network, 10, userOk, [user]),
        update(global, 20, `${userOk} AND ${ipOk}`, [user, network]),
        ...[user, network, global].map((key) =>
          this.db
            .prepare('SELECT attempts FROM auth_throttles WHERE key=?')
            .bind(key),
        ),
        this.db
          .prepare(
            'DELETE FROM auth_throttles WHERE key IN (SELECT key FROM auth_throttles WHERE window_start<=? LIMIT 100)',
          )
          .bind(cutoff),
      ]);
      const max = [3, 10, 20];
      for (let index = 0; index < max.length; index++) {
        const value = (
          result[index + 3]?.results?.[0] as { attempts?: unknown } | undefined
        )?.attempts;
        if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < 1
        )
          throw unavailable();
        if (value > max[index]) throw limit();
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw unavailable();
    }
  }
  async submit(identity: Identity, ip: string, body: unknown) {
    const { title, message } = validate(body);
    if (!this.token?.trim()) throw unavailable();
    await this.throttle(identity, ip);
    const issueTitle = plain(title),
      issueBody = plain(message)
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => '    ' + line)
        .join('\n');
    try {
      const signal = AbortSignal.timeout(10000);
      const response = await fetch(
        'https://api.github.com/repos/seregka23/finance-repo/issues',
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'family-finance-feedback',
          },
          body: JSON.stringify({ title: issueTitle, body: issueBody }),
          signal,
          redirect: 'error',
        },
      );
      if (response.status !== 201) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new Error('delivery');
      }
      const result: unknown = JSON.parse(
        await readProviderBody(response, signal),
      );
      const number = (result as { number?: unknown })?.number;
      if (
        typeof number !== 'number' ||
        !Number.isSafeInteger(number) ||
        number <= 0
      )
        throw new Error('delivery');
      return {
        issueNumber: number,
        issueUrl: `https://github.com/seregka23/finance-repo/issues/${number}`,
      };
    } catch {
      throw failed();
    }
  }
}
@Controller('api/v1/feedback')
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}
  @Post() submit(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.submit(
      req.identity,
      req.get('x-internal-client-ip') ?? '',
      body,
    );
  }
}
