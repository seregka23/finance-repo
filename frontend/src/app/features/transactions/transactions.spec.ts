// jsdom does not implement native dialog methods.
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
};
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Transactions } from './transactions';
import { Api } from '../../core/api';
import { Workspace } from '../../core/workspace';
import { AccountsService } from '../accounts/accounts.service';
import { ReservesService } from '../reserves/reserves.service';
import { CategoriesService } from '../categories/categories.service';
import { FormGroup } from '@angular/forms';

it('keeps pagination on applied filters and suppresses duplicate rows', async () => {
  const request = vi
    .fn()
    .mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('cursor=')
          ? { transactions: [{ id: 'one' }, { id: 'two' }], nextCursor: null }
          : { transactions: [{ id: 'one' }], nextCursor: 'next' },
      ),
    );
  const api = {
    selectedId: Object.assign(() => 'h', {}),
    session: () => ({ households: [{ id: 'h', timeZone: 'UTC' }] }),
    request,
    handleError: async () => 'error',
  };
  TestBed.configureTestingModule({
    imports: [Transactions],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: api },
      { provide: Workspace, useValue: { load: vi.fn() } },
      {
        provide: AccountsService,
        useValue: { list: async () => ({ accounts: [] }), members: async () => ({ members: [] }) },
      },
      { provide: ReservesService, useValue: { list: async () => ({ reserves: [] }) } },
      { provide: CategoriesService, useValue: { list: async () => ({ categories: [] }) } },
    ],
  });
  const fixture = TestBed.createComponent(Transactions);
  await fixture.whenStable();
  const component = fixture.componentInstance as unknown as {
    filters: FormGroup;
    load(more?: boolean): Promise<void>;
    rows(): { id: string }[];
  };
  component.filters.patchValue({ search: 'first' });
  await component.load();
  component.filters.patchValue({ search: 'draft' });
  await component.load(true);
  expect(request.mock.calls.at(-1)?.[0]).toContain('search=first');
  expect(request.mock.calls.at(-1)?.[0]).not.toContain('draft');
  expect(component.rows().map((r) => r.id)).toEqual(['one', 'two']);
});

it('keeps a new draft when an earlier detail request completes late', async () => {
  let resolveDetail!: (value: unknown) => void;
  const detail = new Promise((resolve) => {
    resolveDetail = resolve;
  });
  const row = {
    id: 'old',
    type: 'expense',
    transactionDate: '2026-11-01',
    status: 'posted',
    version: 1,
    authorMemberId: 'm',
    merchant: 'Old',
    note: null,
  };
  const request = vi
    .fn()
    .mockImplementation((path: string) =>
      path.endsWith('/old') ? detail : Promise.resolve({ transactions: [], nextCursor: null }),
    );
  TestBed.configureTestingModule({
    imports: [Transactions],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          selectedId: () => 'h',
          session: () => ({ households: [{ id: 'h', timeZone: 'UTC', memberId: 'm' }] }),
          request,
          handleError: async () => 'error',
        },
      },
      { provide: Workspace, useValue: { load: vi.fn() } },
      {
        provide: AccountsService,
        useValue: {
          list: async () => ({ accounts: [{ id: 'a', status: 'active', currency: 'RSD' }] }),
          members: async () => ({ members: [] }),
        },
      },
      { provide: ReservesService, useValue: { list: async () => ({ reserves: [] }) } },
      { provide: CategoriesService, useValue: { list: async () => ({ categories: [] }) } },
    ],
  });
  const fixture = TestBed.createComponent(Transactions);
  await fixture.whenStable();
  const component = fixture.componentInstance as unknown as {
    open(item: typeof row): Promise<void>;
    create(): void;
    editing(): boolean;
    selected(): unknown;
    form: FormGroup;
  };
  const pending = component.open(row);
  component.create();
  component.form.patchValue({ merchant: 'Draft' });
  component.create();
  resolveDetail(row);
  await pending;
  expect(component.editing()).toBe(true);
  expect(component.selected()).toBeNull();
  expect(component.form.value.merchant).toBe('Draft');
});

it('keeps expense drafts and requires confirmation of a revised reserve split', async () => {
  const { ApiError } = await import('../../core/api');
  const request = vi.fn().mockImplementation((path: string, method?: string) => {
    if (method === 'POST')
      return Promise.reject(new ApiError('RESERVE_INSUFFICIENT_FUNDS', 'shortage', 409, '250'));
    return Promise.resolve({ transactions: [], nextCursor: null });
  });
  TestBed.configureTestingModule({
    imports: [Transactions],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          selectedId: () => 'h',
          session: () => ({ households: [{ id: 'h', timeZone: 'UTC' }] }),
          request,
          handleError: async () => 'error',
        },
      },
      { provide: Workspace, useValue: { load: vi.fn() } },
      {
        provide: AccountsService,
        useValue: {
          list: async () => ({ accounts: [{ id: 'a', status: 'active', currency: 'RSD' }] }),
          members: async () => ({ members: [] }),
        },
      },
      {
        provide: CategoriesService,
        useValue: {
          list: async () => ({ categories: [{ id: 'c', status: 'active', type: 'expense' }] }),
        },
      },
      {
        provide: ReservesService,
        useValue: {
          list: async () => ({
            reserves: [
              { id: 'r', accountId: 'a', status: 'active', balanceMinor: '1000', currency: 'RSD' },
            ],
          }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Transactions);
  await fixture.whenStable();
  const c = fixture.componentInstance as unknown as {
    form: FormGroup;
    save(): Promise<void>;
    useRevisedAllocation(): void;
    revisedAllocation(): string | null;
  };
  c.form.patchValue({
    type: 'expense',
    transactionDate: '2026-11-19',
    accountId: 'a',
    categoryId: 'c',
    amount: '5.00',
    reserveId: 'r',
    reserveAmount: '4.00',
    merchant: 'Draft',
  });
  await c.save();
  expect(request.mock.calls.find((call) => call[1] === 'POST')?.[2]).toMatchObject({
    reserveFunding: { reserveId: 'r', amountMinor: '400' },
  });
  expect(c.revisedAllocation()).toBe('250');
  expect(c.form.value.merchant).toBe('Draft');
  c.useRevisedAllocation();
  expect(c.form.value.reserveAmount).toBe('2.50');
  expect(c.revisedAllocation()).toBeNull();
  expect(request.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1);
});
