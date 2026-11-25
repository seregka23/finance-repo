import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Api } from '../../core/api';
import { Workspace } from '../../core/workspace';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService } from '../categories/categories.service';
import { ImportReview } from './import-review';

const draft = {
  id: 'draft',
  status: 'pending',
  sourceType: 'receipt',
  createdAt: '2026-01-01',
  transactionId: null,
  suggestedAccountId: null,
  categoryDecision: { categoryId: null },
  reviewFlags: [],
  possibleDuplicates: [
    {
      id: 'old',
      transactionDate: '2026-01-01',
      amountMinor: '1200',
      currency: 'RSD',
      merchant: 'Shop',
    },
  ],
  draft: {
    type: 'expense',
    status: 'pending',
    date: '2026-01-01',
    amountMinor: '1200',
    currency: 'RSD',
    merchant: 'Shop',
    recipient: null,
    feeMinor: null,
    purchaseAmountMinor: null,
    purchaseCurrency: null,
    debitAmountMinor: null,
    debitCurrency: null,
    items: [],
  },
};
async function setup() {
  const request = vi.fn(async (path: string, method?: string, body?: unknown) => {
    if (path.endsWith('/preview')) return draft;
    if (path.endsWith('/confirm')) return { transactionId: 'posted' };
    if (path.includes('/transactions?')) return { transactions: [], nextCursor: null };
    return { drafts: [] };
  });
  TestBed.configureTestingModule({
    imports: [ImportReview],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: { selectedId: signal('h'), request, handleError: async () => 'Error' },
      },
      {
        provide: AccountsService,
        useValue: {
          list: async () => ({
            accounts: [{ id: 'a', name: 'Cash', currency: 'RSD', status: 'active' }],
          }),
        },
      },
      {
        provide: CategoriesService,
        useValue: {
          list: async () => ({
            categories: [{ id: 'c', name: 'Food', type: 'expense', status: 'active' }],
          }),
        },
      },
      { provide: Workspace, useValue: { load: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(ImportReview);
  await fixture.whenStable();
  const component = fixture.componentInstance as unknown as {
    source: { patchValue(v: object): void };
    form: { patchValue(v: object): void };
    preview(): Promise<void>;
    confirm(mode: 'post' | 'attach'): Promise<void>;
    error(): string;
  };
  return { fixture, component, request };
}
it('requires settlement and duplicate acknowledgement before posting', async () => {
  const { component, request } = await setup();
  component.source.patchValue({ sourceType: 'sms', text: 'Example bank message' });
  await component.preview();
  component.form.patchValue({ accountId: 'a', categoryId: 'c' });
  await component.confirm('post');
  expect(component.error()).toContain('duplicates');
  component.form.patchValue({ keepSeparate: true });
  await component.confirm('post');
  expect(component.error()).toContain('settlement');
  component.form.patchValue({ settlementConfirmed: true });
  await component.confirm('post');
  const call = request.mock.calls.find(([path]) => path.endsWith('/confirm'));
  expect(call?.[2]).toMatchObject({
    mode: 'post',
    settlementConfirmed: true,
    transaction: { accountId: 'a', categoryId: 'c', amountMinor: '1200' },
  });
});
it('attaches receipt to an expense without a posting body', async () => {
  const { component, request } = await setup();
  component.source.patchValue({ sourceType: 'sms', text: 'Example bank message' });
  await component.preview();
  component.form.patchValue({ existingExpenseId: 'expense' });
  await component.confirm('attach');
  const call = request.mock.calls.find(([path]) => path.endsWith('/confirm'));
  expect(call?.[2]).toEqual({ mode: 'attach', transactionId: 'expense', items: [] });
});
it('retries the original source after recognition fails', async () => {
  const { component, request } = await setup();
  request.mockImplementationOnce(async () => {
    throw new Error('offline');
  });
  component.source.patchValue({ sourceType: 'sms', text: 'First message' });
  await component.preview();
  component.source.patchValue({ text: 'Changed message' });
  (component as unknown as { retry(): void }).retry();
  await vi.waitFor(() =>
    expect(request.mock.calls.filter(([path]) => path.endsWith('/preview'))).toHaveLength(2),
  );
  const calls = request.mock.calls.filter(([path]) => path.endsWith('/preview'));
  expect(calls[1][2]).toEqual({ sourceType: 'sms', text: 'First message' });
});
