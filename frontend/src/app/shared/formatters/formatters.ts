/** Formats a calendar date without shifting its day or remapping early years. */
export function formatCalendarDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

/** Converts a decimal amount to minor units without floating point arithmetic. */
export function decimalToMinor(value: string, signed = false, locale = 'en-US'): string | null {
  if (/^(ru|sr)(-|$)/i.test(locale)) value = value.replace(',', '.');
  const match = value
    .trim()
    .match(signed ? /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/ : /^(\+?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const digits = (match[2] + (match[3] ?? '').padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  return match[1] === '-' && digits !== '0' ? '-' + digits : digits;
}
export function formatMinor(value: string, currency: string, locale = 'en-US'): string {
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).padStart(3, '0');
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    BigInt(digits.slice(0, -2)),
  );
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.';
  return `${negative ? '−' : ''}${whole}${decimal}${digits.slice(-2)} ${currency}`;
}
