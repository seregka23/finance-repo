import { validateTimeZone } from '../finance/calendar.js';
import { invalid } from './households.errors.js';

export function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    value.trim().length > 100
  )
    throw invalid();
  return value.trim();
}
export function timezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw invalid();
  try {
    return validateTimeZone(value);
  } catch {
    throw invalid();
  }
}
export function email(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
    throw invalid();
  return value.toLowerCase();
}
