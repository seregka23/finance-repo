import { apiErrorMessages } from './api-error-messages';
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
      return apiErrorMessages[error.code] ?? 'Something went wrong. Please try again.';
    }
    return 'Could not reach the server. Please check your connection and try again.';
  }
}
