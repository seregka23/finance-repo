import { Component, inject, input, signal } from '@angular/core';
import { Api, ApiError } from '../api';

@Component({
  selector: 'app-auth-panel',
  templateUrl: './auth-panel.html',
})
export class AuthPanel {
  private readonly api = inject(Api);
  readonly invite = input('');
  protected readonly authMode = signal<'login' | 'register' | null>(null);
  protected readonly authPending = signal(false);
  protected readonly authError = signal('');
  protected chooseAuth(mode: 'login' | 'register'): void {
    this.authMode.set(mode);
    this.authError.set('');
    setTimeout(() => document.querySelector<HTMLInputElement>('#auth-email')?.focus());
  }
  protected async authenticate(event: Event): Promise<void> {
    event.preventDefault();
    if (this.authPending()) return;
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const mode = this.authMode();
    if (!mode) return;
    if (mode === 'register' && password !== String(data.get('confirmation') ?? '')) {
      this.authError.set('Passwords do not match. Please check and try again.');
      return;
    }
    this.authPending.set(true);
    this.authError.set('');
    try {
      await this.api.request(`/auth/${mode}`, 'POST', { email, password });
      form.reset();
      await this.api.refreshSession();
      this.authMode.set(null);
    } catch (e) {
      this.authError.set(e instanceof ApiError ? e.message : await this.api.handleError(e));
    } finally {
      this.authPending.set(false);
    }
  }
}
