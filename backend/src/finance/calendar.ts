import { FinanceError } from './money.js';
function invalid(message: string): never {
  throw new FinanceError('INVALID_DATE', message);
}
function daysInMonth(year: number, month: number): number {
  return (
    [
      31,
      year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ][month - 1] ?? 0
  );
}
export function validateDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return invalid('Expected YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  )
    return invalid('Invalid Gregorian date');
  return value;
}
export function validateMonth(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value))
    return invalid('Expected YYYY-MM');
  validateDate(`${value}-01`);
  return value;
}
export function validateTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || /^[+-]/.test(value))
    throw new FinanceError('INVALID_TIME_ZONE', 'Expected an IANA time zone');
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    throw new FinanceError('INVALID_TIME_ZONE', 'Invalid IANA time zone');
  }
  return value;
}
export function monthForFinancialDate(value: unknown): string {
  return validateDate(value).slice(0, 7);
}
export function monthDateRange(value: unknown): {
  startDate: string;
  endDate: string;
} {
  const month = validateMonth(value);
  const [year, number] = month.split('-').map(Number);
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${String(daysInMonth(year, number)).padStart(2, '0')}`,
  };
}
export function householdDateForInstant(
  value: unknown,
  timeZone = 'Europe/Belgrade',
): string {
  validateTimeZone(timeZone);
  if (typeof value !== 'string') return invalid('Expected an offset timestamp');
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return invalid('Expected an offset timestamp');
  validateDate(match[1]);
  const [, , hours, minutes, seconds, , offset] = match;
  if (
    +hours > 23 ||
    +minutes > 59 ||
    +seconds > 59 ||
    (offset !== 'Z' && (+offset.slice(1, 3) > 23 || +offset.slice(4) > 59))
  )
    return invalid('Invalid timestamp');
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return invalid('Invalid timestamp');
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const year = part('year');
  if (part('era') !== 'AD' || +year > 9999)
    return invalid('Household date outside supported range');
  return validateDate(
    `${year.padStart(4, '0')}-${part('month')}-${part('day')}`,
  );
}
export function householdMonthForInstant(
  value: unknown,
  timeZone = 'Europe/Belgrade',
): string {
  return householdDateForInstant(value, timeZone).slice(0, 7);
}
