import { Injectable, inject } from '@angular/core';
import { ApiTransport } from './api-transport';
import { SessionState } from './session-state';

export * from './api-types';
export { ApiError } from './api-transport';

/** Compatibility facade for API consumers. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly transport = inject(ApiTransport);
  private readonly state = inject(SessionState);
  readonly session = this.state.session;
  readonly selectedId = this.state.selectedId;

  request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.transport.request<T>(path, method, body, headers);
  }
  requestBlob(path: string): Promise<Blob> {
    return this.transport.requestBlob(path);
  }
  refreshSession(preferred?: string): Promise<void> {
    return this.state.refreshSession(preferred);
  }
  handleError(error: unknown): Promise<string> {
    return this.state.handleError(error);
  }
}
