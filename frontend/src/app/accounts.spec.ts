import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Accounts } from './accounts';
import { Account, AccountsService } from './accounts.service';
import { Api } from './api';
import { Workspace } from './workspace';

const household = (id: string) => ({
  id,
  name: id,
  baseCurrency: 'RSD',
  timeZone: 'Europe/Belgrade',
  role: 'owner' as const,
  memberId: id + '-member',
});
const account = (id: string, name: string): Account => ({
  id,
  name,
  type: 'cash',
  currency: 'RSD',
  ownerMemberId: null,
  designation: 'personal',
  status: 'active',
  version: 1,
  currencyLocked: false,
  balanceMinor: '0',
  reservedMinor: '0',
  availableMinor: '0',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(list: (h: string) => Promise<{ accounts: Account[] }>) {
  const service = {
    list: vi.fn(list),
    members: vi.fn().mockResolvedValue({ members: [], invitations: [] }),
    create: vi.fn(),
    get: vi.fn(),
    movements: vi.fn(),
  };
  const load = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    imports: [Accounts],
    providers: [
      provideRouter([]),
      { provide: AccountsService, useValue: service },
      { provide: Workspace, useValue: { load } },
    ],
  });
  const api = TestBed.inject(Api);
  api.session.set({
    user: { email: 'fixture@example.invalid' },
    households: [household('one'), household('two')],
  });
  api.selectedId.set('one');
  const fixture = TestBed.createComponent(Accounts);
  await fixture.whenStable();
  return { api, fixture, service, load, element: fixture.nativeElement as HTMLElement };
}
describe('account household boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('ignores an old household list response after switching households', async () => {
    const old = deferred<{ accounts: Account[] }>();
    const { api, fixture, element } = await setup((h) =>
      h === 'one'
        ? old.promise
        : Promise.resolve({ accounts: [account('two-account', 'Current household account')] }),
    );
    api.selectedId.set('two');
    await fixture.whenStable();
    old.resolve({ accounts: [account('private', 'Previous private account')] });
    await Promise.resolve();
    await fixture.whenStable();
    expect(element.textContent).toContain('Current household account');
    expect(element.textContent).not.toContain('Previous private account');
  });
  it('discards an in-flight creation result and clears inputs on household switch', async () => {
    const pending = deferred<Account>();
    const { api, fixture, service, load, element } = await setup(async () => ({ accounts: [] }));
    service.create.mockReturnValue(pending.promise);
    await vi.waitFor(() =>
      expect(element.querySelector('input[formcontrolname="name"]')).not.toBeNull(),
    );
    const name = element.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    name.value = 'Previous private account';
    name.dispatchEvent(new Event('input'));
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(service.create).toHaveBeenCalledOnce();
    api.selectedId.set('two');
    await fixture.whenStable();
    pending.resolve(account('private', 'Previous private account'));
    await Promise.resolve();
    await fixture.whenStable();
    expect(element.textContent).not.toContain('Previous private account');
    expect(element.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!.value).toBe(
      '',
    );
    expect(load).not.toHaveBeenCalled();
  });
  it('defaults financial dates to the household date around UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-01-01T23:30:00Z'));
    const { element } = await setup(async () => ({ accounts: [] }));
    await vi.waitFor(() => expect(element.querySelector('input[type="date"]')).not.toBeNull());
    expect(element.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-01-02');
  });
});
