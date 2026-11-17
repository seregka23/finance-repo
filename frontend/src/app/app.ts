import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api, ApiError, AuthConfig } from './api';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  host: { '(window:hashchange)': 'captureInvitation()' },
})
export class App {
  protected readonly api = inject(Api);
  protected readonly currentTitle = signal('Dashboard');
  protected readonly navigation = [
    { label: 'Dashboard', path: '/dashboard', icon: 'm3 10 9-7 9 7M5 9v11h14V9M10 20v-6h4v6' },
    { label: 'Accounts', path: '/accounts', icon: 'M3 7h18v12H3zM3 10h18M16 15h2' },
    {
      label: 'Transactions',
      path: '/transactions',
      icon: 'M4 7h15l-3-3M20 17H5l3 3M19 7l-3 3M5 17l3-3',
    },
    { label: 'Budgets', path: '/budgets', icon: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5' },
    {
      label: 'Reserves',
      path: '/reserves',
      icon: 'M4 10h16v10H4zM7 10V7a5 5 0 0 1 10 0v3M12 14v3',
    },
    { label: 'Reports', path: '/reports', icon: 'M4 20h16M6 17v-5M12 17V5M18 17V9' },
  ];
  protected selectHousehold(event: Event): void {
    this.api.selectedId.set((event.target as HTMLSelectElement).value);
  }
  private readonly router = inject(Router);
  protected readonly config = signal<AuthConfig | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly invite = signal(sessionStorage.getItem('family-invite') ?? '');
  protected readonly accepting = signal(false);
  protected readonly authMode = signal<'login' | 'register' | null>(null);
  protected readonly authPending = signal(false);
  protected readonly authError = signal('');
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        document.querySelector<HTMLDetailsElement>('.profile-menu')?.removeAttribute('open');
        const path = event.urlAfterRedirects.split(/[?#]/)[0];
        this.currentTitle.set(
          path === '/settings'
            ? 'Household settings'
            : path === '/categories' ? 'Categories'
            : (this.navigation.find((item) => item.path === path)?.label ?? 'Dashboard'),
        );
        setTimeout(() => document.querySelector<HTMLElement>('.content h1')?.focus());
      }
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
  protected async logout(): Promise<void> {
    try {
      await this.api.request('/auth/logout', 'POST');
    } catch (e) {
      this.error.set(await this.api.handleError(e));
      return;
    }
    this.api.session.set(null);
    this.api.selectedId.set(null);
    this.authMode.set(null);
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
