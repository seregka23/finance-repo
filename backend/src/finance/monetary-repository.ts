import { Inject, Injectable } from '@nestjs/common';
import type { Identity } from '../auth/auth.js';
import { DATABASE } from '../health.controller.js';
import {
  HouseholdAccessService,
  type Database,
} from '../households/households.js';
import { monthDateRange } from './calendar.js';
import {
  summarizeRecordedMoney,
  type RecordedMoneyMovement,
} from './recorded-money.js';

/** Reads raw account movements; this is not an income, expense, or net report. */
@Injectable()
export class MonetaryRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: HouseholdAccessService,
  ) {}

  async readRecordedMonth(
    identity: Identity,
    householdId: string,
    month: string,
  ) {
    const { startDate, endDate } = monthDateRange(month);
    // Read amounts as text to retain full SQLite integer precision in D1.
    // Keep the read in the same atomic batch as the live access assertion.
    const [, result] = await this.access.batch(
      identity,
      householdId,
      'member',
      [
        this.db
          .prepare(
            `SELECT id, movement_date AS movementDate,
        CAST(amount_minor AS TEXT) AS amountMinor, currency,
        CAST(rsd_equivalent_minor AS TEXT) AS rsdEquivalentMinor,
        exchange_rate AS exchangeRate, exchange_rate_source AS exchangeRateSource
        FROM account_movements
        WHERE household_id=? AND movement_date>=? AND movement_date<=?
        ORDER BY movement_date, id`,
          )
          .bind(householdId, startDate, endDate),
      ],
    );
    const records = result.results as unknown as RecordedMoneyMovement[];
    return { records, summary: summarizeRecordedMoney(records) };
  }
}
