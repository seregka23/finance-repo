import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { Budgets, percent, progress } from './budgets';
import { Api } from '../../core/api';
import { Workspace } from '../../core/workspace';
import { CategoriesService } from '../categories/categories.service';

it('formats signed basis points exactly and clamps only the visual progress', () => {
  expect(percent('2000')).toBe('20%');
  expect(percent('-125')).toBe('−1.25%');
  expect(percent('900719925474099100')).toBe('9,007,199,254,740,991%');
  expect(percent('-125', 'ru-RU')).toBe('−1,25%');
  expect(progress('-125')).toBe(0);
  expect(progress('12001')).toBe(100);
});

it('displays missing FX as an incomplete subtotal without a progress claim', async () => {
  const request = vi.fn().mockResolvedValue({
    month: '2026-11',
    plans: [
      {
        id: 'p',
        month: '2026-11',
        categoryId: 'c',
        categoryName: 'Food',
        categoryStatus: 'active',
        limitMinor: '1000000',
        actualMinor: '800000',
        remainingMinor: null,
        overspentMinor: null,
        utilizationBasisPoints: null,
        missingFxCount: 1,
      },
    ],
  });
  TestBed.configureTestingModule({
    imports: [Budgets],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: { selectedId: signal('h'), request, handleError: async () => 'error' },
      },
      { provide: Workspace, useValue: { load: vi.fn() } },
      {
        provide: CategoriesService,
        useValue: { listEligible: async () => ({ categories: [{ id: 'c', name: 'Food' }] }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(Budgets);
  await fixture.whenStable();
  fixture.detectChanges();
  const text = fixture.nativeElement.textContent as string;
  expect(text).toContain('Known spending subtotal');
  expect(text).toContain('8,000.00 RSD');
  expect(text).toContain('Incomplete:');
  expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
  expect(text).not.toContain('remaining');
  expect(text).not.toContain('over budget');
});

it('ignores a previous month response when the month changes', async () => {
  let resolveOld!: (v: unknown) => void;
  const old = new Promise((resolve) => (resolveOld = resolve));
  const request = vi
    .fn()
    .mockImplementation((path: string) =>
      path.includes('2026-10')
        ? old
        : Promise.resolve({ month: path.includes('2026-12') ? '2026-12' : '2026-11', plans: [] }),
    );
  TestBed.configureTestingModule({
    imports: [Budgets],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: { selectedId: signal('h'), request, handleError: async () => 'error' },
      },
      { provide: Workspace, useValue: { load: vi.fn() } },
      { provide: CategoriesService, useValue: { listEligible: async () => ({ categories: [] }) } },
    ],
  });
  const fixture = TestBed.createComponent(Budgets);
  await fixture.whenStable();
  fixture.detectChanges();
  const input = fixture.nativeElement.querySelector('#budget-month') as HTMLInputElement;
  input.value = '2026-10';
  input.dispatchEvent(new Event('change'));
  input.value = '2026-12';
  input.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  resolveOld({ month: '2026-10', plans: [{ id: 'old' }] });
  await Promise.resolve();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(input.value).toBe('2026-12');
  expect(fixture.nativeElement.textContent).not.toContain('old');
});

it('keeps existing plans visible when category options fail', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({
      month: '2026-11',
      plans: [
        {
          id: 'p',
          month: '2026-11',
          categoryId: 'c',
          categoryName: 'Food',
          categoryStatus: 'archived',
          limitMinor: '0',
          actualMinor: '-100',
          remainingMinor: '100',
          overspentMinor: '0',
          utilizationBasisPoints: null,
          missingFxCount: 0,
        },
      ],
    });
  TestBed.configureTestingModule({
    imports: [Budgets],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: { selectedId: signal('h'), request, handleError: async () => 'error' },
      },
      { provide: Workspace, useValue: { load: vi.fn() } },
      {
        provide: CategoriesService,
        useValue: {
          listEligible: async () => {
            throw new Error('offline');
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Budgets);
  await fixture.whenStable();
  fixture.detectChanges();
  const text = fixture.nativeElement.textContent as string;
  expect(text).toContain('Food');
  expect(text).toContain('−1.00 RSD');
  expect(text).toContain('No percentage for a zero limit.');
  expect(text).toContain('Budget categories are unavailable.');
  expect(fixture.nativeElement.querySelector('[aria-label="Edit budget Food"]')).not.toBeNull();
  expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
});
