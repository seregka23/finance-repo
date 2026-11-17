import { TestBed } from '@angular/core/testing';
import { Api } from './api';
import { Workspace, WorkspaceData } from './workspace';
import { ResultsState } from '../shared/ui/results-state';
import { vi } from 'vitest';

beforeEach(() => localStorage.setItem('family-finance-language', 'en'));
afterEach(() => localStorage.removeItem('family-finance-language'));

const data = (accounts: number): WorkspaceData => ({
  counts: { accounts, transactions: 0, plans: 0, reserves: 0, accountMovements: 0 },
  capabilities: {
    accounts: false,
    transactions: false,
    imports: false,
    budgets: false,
    reserves: false,
    reports: false,
  },
});
describe('workspace state', () => {
  it('ignores an old household response after selection changes', async () => {
    const api = TestBed.inject(Api);
    let resolveFirst!: (value: WorkspaceData) => void;
    vi.spyOn(api, 'request').mockImplementation((path) =>
      path.includes('/first/')
        ? (new Promise<WorkspaceData>((resolve) => {
            resolveFirst = resolve;
          }) as never)
        : (Promise.resolve(data(2)) as never),
    );
    const workspace = TestBed.inject(Workspace);
    api.selectedId.set('first');
    TestBed.tick();
    api.selectedId.set('second');
    TestBed.tick();
    await vi.waitFor(() => expect(workspace.data()?.counts.accounts).toBe(2));
    resolveFirst(data(1));
    await Promise.resolve();
    expect(workspace.data()?.counts.accounts).toBe(2);
  });
  it('keeps failures distinct from empty data and can retry', async () => {
    const api = TestBed.inject(Api);
    const request = vi
      .spyOn(api, 'request')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(data(0));
    const workspace = TestBed.inject(Workspace);
    api.selectedId.set('first');
    TestBed.tick();
    await vi.waitFor(() => expect(workspace.error()).toContain('Could not reach'));
    expect(workspace.data()).toBeNull();
    await workspace.load();
    expect(workspace.data()?.counts.accounts).toBe(0);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
describe('results state', () => {
  it('emits reset from its native button', () => {
    const fixture = TestBed.createComponent(ResultsState);
    fixture.componentRef.setInput('variant', 'no-match');
    const reset = vi.fn();
    fixture.componentInstance.reset.subscribe(reset);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Reset filters');
    button.click();
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe('financial navigation and transaction chooser', () => {
  it('defines the six lazy routes and the settings route', async () => {
    const { routes } = await import('../app.routes');
    for (const path of [
      'dashboard',
      'accounts',
      'transactions',
      'budgets',
      'reserves',
      'reports',
      'settings',
    ]) {
      const route = routes.find((item) => item.path === path);
      expect(route?.loadComponent).toBeTypeOf('function');
    }
    expect(routes.find((item) => item.path === '')?.redirectTo).toBe('dashboard');
  });
  it('opens the chooser once and restores focus after close', async () => {
    const { Finance } = await import('../features/finance/finance');
    const { ActivatedRoute, provideRouter } = await import('@angular/router');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { page: 'Dashboard' } } } },
      ],
    });
    const api = TestBed.inject(Api);
    api.session.set({
      user: { email: 'a@example.com' },
      households: [
        {
          id: 'one',
          name: 'Home',
          baseCurrency: 'RSD',
          timeZone: 'UTC',
          role: 'owner',
          memberId: 'a',
        },
      ],
    });
    api.selectedId.set('one');
    vi.spyOn(api, 'request').mockResolvedValue(data(0));
    const fixture = TestBed.createComponent(Finance);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = Array.from(element.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add transaction'),
    )!;
    const dialog = element.querySelector('dialog')!;
    const show = vi.fn(() => dialog.setAttribute('open', ''));
    dialog.showModal = show;
    dialog.close = () => {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    };
    document.body.appendChild(element);
    button.focus();
    button.click();
    button.click();
    expect(show).toHaveBeenCalledOnce();
    expect(element.querySelectorAll('dialog button:disabled')).toHaveLength(3);
    Array.from(dialog.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Close'))!
      .click();
    expect(document.activeElement).toBe(button);
    fixture.destroy();
    element.remove();
  });
});
