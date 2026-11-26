import { Injectable } from '@nestjs/common';
import { apiError, unavailable } from '../auth/auth.errors.js';
import type { Identity } from '../auth/auth.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { monthDateRange } from './calendar.js';
import {
  summarizeRecordedMoney,
  type RecordedMoneyMovement,
} from './recorded-money.js';

/** Reads raw account movements; this is not an income, expense, or net report. */
@Injectable()
export class MonetaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async readRecordedMonth(
    identity: Identity,
    householdId: string,
    month: string,
  ) {
    const { startDate, endDate } = monthDateRange(month);
    let rows: (RecordedMoneyMovement | { id: null })[];
    try {
      rows = await this.prisma.$queryRaw(Prisma.sql`
        SELECT m.id,m.movement_date AS movementDate,CAST(m.amount_minor AS TEXT) AS amountMinor,m.currency,
          CAST(m.rsd_equivalent_minor AS TEXT) AS rsdEquivalentMinor,
          m.exchange_rate AS exchangeRate,m.exchange_rate_source AS exchangeRateSource
        FROM households h JOIN household_members member ON member.household_id=h.id
          AND member.identity_subject=${identity.subject} AND member.status='active'
        LEFT JOIN account_movements m ON m.household_id=h.id AND m.movement_date>=${startDate} AND m.movement_date<=${endDate}
        WHERE h.id=${householdId} AND h.status='active' ORDER BY m.movement_date,m.id`);
    } catch {
      throw unavailable();
    }
    if (!rows.length)
      throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
    const records = rows.filter(
      (row): row is RecordedMoneyMovement => row.id !== null,
    );
    return { records, summary: summarizeRecordedMoney(records) };
  }
}
