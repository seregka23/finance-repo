import { Injectable, signal } from '@angular/core';
export interface Household {
  id: string;
  name: string;
  baseCurrency: string;
  timeZone: string;
  role: 'owner' | 'member';
  memberId: string;
}
export interface Session {
  user: { email: string };
  households: Household[];
}
export interface AuthConfig {
  configured: boolean;
  signInUrl: string | null;
  signOutUrl: string | null;
}
export interface Members {
  members: { id: string; email: string | null; role: string; status: string }[];
  invitations: { id: string; email: string; status: string; expiresAt: string }[];
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
@Injectable({ providedIn: 'root' })
export class Api {
  readonly session = signal<Session | null>(null);
  readonly selectedId = signal<string | null>(null);
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch('/api/v1' + path, {
      method,
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data: { error?: { code?: string; message?: string } } = await response
        .json()
        .catch(() => ({}));
      throw new ApiError(
        data.error?.code ?? 'REQUEST_FAILED',
        data.error?.message ?? 'Something went wrong. Please try again.',
        response.status,
      );
    }
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  }
  async refreshSession(preferred?: string): Promise<void> {
    const session = await this.request<Session>('/session');
    this.session.set(session);
    const id = preferred ?? this.selectedId();
    this.selectedId.set(
      session.households.find((h) => h.id === id)?.id ?? session.households[0]?.id ?? null,
    );
  }
  async handleError(error: unknown): Promise<string> {
    if (error instanceof ApiError) {
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
      return error.message;
    }
    return 'Could not reach the server. Please check your connection and try again.';
  }
}
