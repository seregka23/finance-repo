import { describe, expect, it } from 'vitest';
import {
  householdDateForInstant,
  householdMonthForInstant,
  monthDateRange,
  monthForFinancialDate,
  validateDate,
  validateTimeZone,
} from './calendar.js';
describe('calendar', () => {
  it('validates Gregorian dates and inclusive ranges', () => {
    expect(validateDate('2000-02-29')).toBe('2000-02-29');
    expect(() => validateDate('1900-02-29')).toThrow();
    expect(() => validateDate('0000-01-01')).toThrow();
    expect(monthDateRange('9999-12')).toEqual({
      startDate: '9999-12-01',
      endDate: '9999-12-31',
    });
    expect(monthForFinancialDate('2024-03-31')).toBe('2024-03');
  });
  it('uses the household zone at month and DST boundaries', () => {
    expect(householdMonthForInstant('2024-03-31T22:30:00Z')).toBe('2024-04');
    expect(householdDateForInstant('2024-03-31T00:30:00Z')).toBe('2024-03-31');
    expect(() => householdDateForInstant('2024-02-30T12:00:00Z')).toThrow();
    expect(() => householdDateForInstant('2024-01-01T12:00:00')).toThrow();
    expect(() => validateTimeZone('Not/AZone')).toThrow();
  });
});
