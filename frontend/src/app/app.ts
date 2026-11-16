import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api, ApiError, AuthConfig } from './api';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  host: { '(window:hashchange)': 'captureInvitation()' },
})
export class App {
  protected readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly config = signal<AuthConfig | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly invite = signal(sessionStorage.getItem('family-invite') ?? '');
  protected readonly accepting = signal(false);
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd && event.urlAfterRedirects.includes('#invite=')) {
        this.captureInvitation();
        void this.router.navigateByUrl(event.urlAfterRedirects.split('#')[0], { replaceUrl: true });
      }
    });
    void this.load();
  }
  protected captureInvitation(): void {
    const invitation = new URLSearchParams(location.hash.slice(1)).get('invite');
    if (!invitation) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    if (!/^[A-Za-z0-9_-]{43}$/.test(invitation)) {
      this.error.set('This invitation link is invalid. Ask the owner for a new link.');
      return;
    }
    sessionStorage.setItem('family-invite', invitation);
    this.invite.set(invitation);
  }
  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const config = await this.api.request<AuthConfig>('/auth/config');
      this.config.set(config);
      if (config.configured) {
        try {
          await this.api.refreshSession();
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) throw e;
          this.api.session.set(null);
          this.api.selectedId.set(null);
        }
      } else {
        this.api.session.set(null);
        this.api.selectedId.set(null);
      }
    } catch (e) {
      this.error.set(await this.api.handleError(e));
    } finally {
      this.loading.set(false);
    }
  }
  protected async accept(): Promise<void> {
    this.accepting.set(true);
    this.error.set('');
    try {
      const h = await this.api.request<{ id: string }>('/invitations/accept', 'POST', {
        token: this.invite(),
      });
      sessionStorage.removeItem('family-invite');
      this.invite.set('');
      await this.api.refreshSession(h.id);
    } catch (e) {
      this.error.set(await this.api.handleError(e));
    } finally {
      this.accepting.set(false);
    }
  }
  protected dismissInvite(): void {
    sessionStorage.removeItem('family-invite');
    this.invite.set('');
  }
}
