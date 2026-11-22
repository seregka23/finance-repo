import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { Finance } from './finance';
import { Api } from '../../core/api';
import { Workspace } from '../../core/workspace';
import { CategoriesService } from '../categories/categories.service';

beforeEach(() => localStorage.setItem('family-finance-language', 'en'));
afterEach(() => localStorage.removeItem('family-finance-language'));
const session = { households: [{ id: 'h', baseCurrency: 'RSD', timeZone: 'UTC' }] };
const result = {
  month: '2026-11',
  monthTransactionCount: 2,
  matchedTransactionCount: 1,
  totals: {
    incomeMinor: '100',
    expenseMinor: '-500',
    netMinor: '600',
    missingFxCount: 1,
    originalCurrencies: [
      { currency: 'EUR', incomeMinor: '0', expenseMinor: '123', netMinor: '-123' },
    ],
  },
  balances: [],
  byCategory: [{ categoryId: 'c', name: 'Food', expenseMinor: '-500', missingFxCount: 1 }],
  byMerchant: [],
};
it('labels incomplete RSD, retains original currency and sends literal filters', async () => {
  const request = vi.fn().mockResolvedValue(result);
  TestBed.configureTestingModule({
    imports: [Finance],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { data: { page: 'Reports' } } } },
      {
        provide: Api,
        useValue: {
          selectedId: signal('h'),
          session: signal(session),
          request,
          handleError: async () => 'error',
        },
      },
      { provide: Workspace, useValue: { data: signal(null) } },
      {
        provide: CategoriesService,
        useValue: {
          list: async () => ({ categories: [{ id: 'c', name: 'Food', status: 'archived' }] }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Finance);
  await fixture.whenStable();
  fixture.detectChanges();
  const text = fixture.nativeElement.textContent as string;
  expect(text).toContain('incomplete known subtotals');
  expect(text).toContain('−5.00 RSD');
  expect(text).toContain('1.23 EUR');
  expect(text).toContain('archived');
  const merchant = fixture.nativeElement.querySelector('#report-merchant') as HTMLInputElement;
  merchant.value = '%_shop';
  merchant.dispatchEvent(new Event('input'));
  fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
  await fixture.whenStable();
  expect(request.mock.calls.at(-1)?.[0]).toContain('merchant=%25_shop');
});
it('ignores an older household dashboard response', async () => {
  let first!: (value: unknown) => void;
  const selectedId = signal('a');
  const request = vi
    .fn()
    .mockImplementation((path: string) =>
      path.includes('/a/')
        ? new Promise((resolve) => (first = resolve))
        : Promise.resolve({
            month: '2026-11',
            totals: {
              incomeMinor: '0',
              expenseMinor: '0',
              netMinor: '0',
              missingFxCount: 0,
              originalCurrencies: [],
            },
            balances: [],
            recentTransactions: [],
          }),
    );
  const sessions = {
    households: [
      { id: 'a', baseCurrency: 'RSD', timeZone: 'UTC' },
      { id: 'b', baseCurrency: 'RSD', timeZone: 'UTC' },
    ],
  };
  TestBed.configureTestingModule({
    imports: [Finance],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { data: { page: 'Dashboard' } } } },
      {
        provide: Api,
        useValue: {
          selectedId,
          session: signal(sessions),
          request,
          handleError: async () => 'error',
        },
      },
      { provide: Workspace, useValue: { data: signal(null) } },
    ],
  });
  const fixture = TestBed.createComponent(Finance);
  fixture.detectChanges();
  selectedId.set('b');
  fixture.detectChanges();
  await fixture.whenStable();
  first({ month: 'old', totals: {}, balances: [], recentTransactions: [] });
  await Promise.resolve();
  fixture.detectChanges();
  expect((fixture.componentInstance as unknown as { dashboard(): { month: string } | null }).dashboard()?.month).toBe('2026-11');
});
