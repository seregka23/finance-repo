import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { App } from './app';
import { Api, ApiError } from './api';

describe('household session', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });
  it('shows administrator setup when Access is unconfigured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ configured: false, signInUrl: null, signOutUrl: null }), {
        status: 200,
      }),
    );
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Sign-in is not configured yet');
    });
    expect(fixture.nativeElement.textContent).toContain('Sign-in is not configured yet');
    expect(fixture.nativeElement.querySelector('a[href*="login"]')).toBeNull();
  });
  it('preserves a selected household only while it remains in the session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { email: 'a@example.com' },
          households: [{ id: 'one' }, { id: 'two' }],
        }),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ user: { email: 'a@example.com' }, households: [{ id: 'one' }] }),
      ),
    );
    const api = TestBed.inject(Api);
    await api.refreshSession('two');
    expect(api.selectedId()).toBe('two');
    await api.refreshSession();
    expect(api.selectedId()).toBe('one');
  });
  it('turns structured API failures into actionable errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'HOUSEHOLD_FULL', message: 'Household is full' } }),
        { status: 409 },
      ),
    );
    const api = TestBed.inject(Api);
    await expect(
      api.request('/households/x/invitations', 'POST', { email: 'b@example.com' }),
    ).rejects.toMatchObject({ code: 'HOUSEHOLD_FULL', status: 409 });
    api.selectedId.set('stale');
    expect(await api.handleError(new ApiError('UNAUTHENTICATED', 'No session', 401))).toContain(
      'sign in',
    );
    expect(api.selectedId()).toBeNull();
  });
});

describe('invitation form', () => {
  afterEach(() => vi.restoreAllMocks());
  it('submits the owner invitation through Angular without navigating away', async () => {
    const { Settings } = await import('./settings');
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const household = {
      id: 'household',
      name: 'Our household',
      baseCurrency: 'RSD',
      timeZone: 'Europe/Belgrade',
      role: 'owner' as const,
      memberId: 'owner',
    };
    const api = TestBed.inject(Api);
    api.session.set({ user: { email: 'owner@example.com' }, households: [household] });
    api.selectedId.set(household.id);
    const request = vi
      .spyOn(api, 'request')
      .mockImplementation(async (path: string, method?: string) => {
        if (method === 'POST') return { token: 'invitation-token' };
        return {
          members: [{ id: 'owner', email: 'owner@example.com', role: 'owner', status: 'active' }],
          invitations: [],
        };
      });
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input[type="email"]')!;
    input.value = 'member@example.com';
    input.dispatchEvent(new Event('input'));
    const form = input.closest('form')!;
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(submit.defaultPrevented).toBe(true);
    expect(request).toHaveBeenCalledWith('/households/household/invitations', 'POST', {
      email: 'member@example.com',
    });
    expect(element.querySelector<HTMLInputElement>('#invite-link')?.value).toContain(
      '/#invite=invitation-token',
    );
  });
});

describe('invitation links in an open app', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
  });
  it('captures a new fragment invitation and removes it from the address bar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ configured: false, signInUrl: null, signOutUrl: null })),
    );
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const token = 'a'.repeat(43);
    history.replaceState({}, '', `/#invite=${token}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    fixture.detectChanges();
    expect(sessionStorage.getItem('family-invite')).toBe(token);
    expect(location.hash).toBe('');
  });
});
