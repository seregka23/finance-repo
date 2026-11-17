import { apiError, unavailable } from '../auth/auth.errors.js';

export const notFound = () =>
  apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
export const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
export const ownerRequired = () =>
  apiError(403, 'OWNER_REQUIRED', 'Owner access required');
export const invitationInvalid = () =>
  apiError(409, 'INVITATION_INVALID', 'Invitation is invalid or expired');
export function dbError(error: unknown): never {
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
