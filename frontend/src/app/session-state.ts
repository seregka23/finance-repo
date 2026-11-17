import { Service, inject, signal } from '@angular/core';
import { ApiError, ApiTransport } from './api-transport';
import { Session } from './api-types';

@Service()
export class SessionState {
  private readonly transport = inject(ApiTransport);
  readonly session = signal<Session | null>(null);
  readonly selectedId = signal<string | null>(null);
  async refreshSession(preferred?: string): Promise<void> {
    const session = await this.transport.request<Session>('/session');
    this.session.set(session);
    const id = preferred ?? this.selectedId();
    this.selectedId.set(
      session.households.find((h) => h.id === id)?.id ?? session.households[0]?.id ?? null,
    );
  }
  async handleError(error: unknown): Promise<string> {
    if (error instanceof ApiError) {
      if (error.code === 'INVALID_CREDENTIALS') return 'Invalid email or password.';
      if (error.status === 401) {
        this.session.set(null);
        this.selectedId.set(null);
        return 'Your session has ended. Please sign in again.';
      }
      if (error.code === 'HOUSEHOLD_NOT_FOUND') {
        this.selectedId.set(null);
        try {
          await this.refreshSession();
        } catch {
          this.session.set(null);
        }
        return 'This household is no longer available. Your household list has been refreshed.';
      }
      const errors: Record<string, string> = {
        INSUFFICIENT_FUNDS: 'Insufficient funds for this operation.',
        CURRENCY_LOCKED: 'Currency cannot be changed after the first transaction.',
        ACCOUNT_NOT_ELIGIBLE: 'This account is unavailable or cannot be used for this operation.',
        ACCOUNT_NOT_FOUND: 'This account is unavailable or cannot be used for this operation.',
        OWNER_NOT_ELIGIBLE: 'Choose an eligible account owner.',
        CATEGORY_NOT_FOUND: 'This category is unavailable or cannot be used for this operation.',
        CATEGORY_NOT_ELIGIBLE: 'This category is unavailable or cannot be used for this operation.',
        CATEGORY_TYPE_IMMUTABLE: "A category's type cannot be changed.",
        TRANSACTION_LINKED: 'This transaction is unavailable or linked to other activity.',
        TRANSACTION_NOT_FOUND: 'This transaction is unavailable or linked to other activity.',
        IDEMPOTENCY_CONFLICT:
          'This request conflicts with an earlier request. Refresh and try again.',
        PAYLOAD_TOO_LARGE: 'The submitted data is too large.',
        INVALID_ORIGIN: 'This request could not be verified. Reload the page and try again.',
        DATABASE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again later.',
        AUTH_UNAVAILABLE: 'The service is temporarily unavailable. Please try again later.',
        VERSION_CONFLICT: 'This item has changed. Refresh and try again.',
        INVITATION_INVALID: 'This invitation is invalid or has expired.',
        HOUSEHOLD_FULL: 'This household already has the maximum number of members.',
        OWNER_REQUIRED: 'You do not have permission to do this.',
        INVALID_INPUT: 'Please check the entered information.',
        INVALID_AMOUNT: 'Please check the entered information.',
        INVALID_DATE: 'Please check the entered information.',
        INVALID_TIME_ZONE: 'Please check the entered information.',
        RATE_LIMITED: 'Too many requests. Please try again later.',
      };
      return errors[error.code] ?? 'Something went wrong. Please try again.';
    }
    return 'Could not reach the server. Please check your connection and try again.';
  }
}
