import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Localization } from './localization';
import { ru } from './ru-catalog';
import { sr } from './sr-catalog';
import {
  decimalToMinor,
  formatCalendarDate,
  formatMinor,
} from '../../shared/formatters/formatters';

describe('runtime localization', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });
  it('uses a saved preference and persists changes', () => {
    localStorage.setItem('family-finance-language', 'ru');
    const i18n = TestBed.inject(Localization);
    expect(i18n.language()).toBe('ru');
    i18n.set('sr');
    expect(localStorage.getItem('family-finance-language')).toBe('sr');
    expect(i18n.t('View {name}', { name: 'Income' })).toBe('Prikaži Income');
  });
  it('uses browser language for invalid storage and survives blocked storage', () => {
    localStorage.setItem('family-finance-language', 'invalid');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('sr-RS');
    expect(TestBed.inject(Localization).language()).toBe('sr');
    TestBed.resetTestingModule();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const i18n = TestBed.inject(Localization);
    i18n.set('ru');
    expect(i18n.language()).toBe('ru');
  });
  it('has matching catalog keys and interpolation fields', () => {
    expect(Object.keys(sr).sort()).toEqual(Object.keys(ru).sort());
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      const fields = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
      expect(fields(ru[key])).toEqual(fields(key));
      expect(fields(sr[key])).toEqual(fields(key));
    }
  });
  it('parses decimal commas only for supported locales and rejects ambiguous input', () => {
    expect(decimalToMinor('10,50')).toBeNull();
    expect(decimalToMinor('10,50', false, 'ru-RU')).toBe('1050');
    expect(decimalToMinor('-90071992547409,91', true, 'sr-Latn-RS')).toBe('-9007199254740991');
    expect(decimalToMinor('1,234.56', true, 'ru-RU')).toBeNull();
    expect(decimalToMinor('1,2,3', true, 'sr-Latn-RS')).toBeNull();
    expect(decimalToMinor('1e3', true, 'ru-RU')).toBeNull();
  });
  it('formats early and modern calendar dates without shifting the day', () => {
    expect(formatCalendarDate('0099-01-02', 'en-US')).toBe('Jan 2, 99');
    expect(formatCalendarDate('0099-01-02', 'ru-RU')).toBe('2 янв. 99 г.');
    expect(formatCalendarDate('2026-01-02', 'en-US')).toBe('Jan 2, 2026');
    expect(formatCalendarDate('2026-01-02', 'sr-Latn-RS')).toBe('2. 1. 2026.');
  });
  it('formats exact large minor units without losing precision', () => {
    expect(formatMinor('9007199254740991', 'RSD')).toBe('90,071,992,547,409.91 RSD');
    expect(formatMinor('9007199254740991', 'EUR', 'ru-RU')).toBe('90 071 992 547 409,91 EUR');
    expect(formatMinor('-9007199254740991', 'USD', 'sr-Latn-RS')).toBe(
      '−90.071.992.547.409,91 USD',
    );
  });
});

describe('localized authentication', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });
  it('updates an existing validation error and document title on language change', async () => {
    const { App } = await import('../../app');
    const { provideRouter } = await import('@angular/router');
    localStorage.setItem('family-finance-language', 'en');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url) =>
        new Response(
          String(url).endsWith('/auth/config') ? JSON.stringify({ configured: true }) : '{}',
          { status: String(url).endsWith('/auth/config') ? 200 : 401 },
        ),
    );
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(fixture.nativeElement.textContent).toContain('Create account');
    });
    const el = fixture.nativeElement as HTMLElement;
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Create account')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLInputElement>('#auth-password')!.value = 'longpassword123';
    el.querySelector<HTMLInputElement>('#auth-confirmation')!.value = 'otherpassword123';
    el.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(el.textContent).toContain('Passwords do not match');
    const selector = el.querySelector<HTMLSelectElement>('#app-language')!;
    selector.value = 'ru';
    selector.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Пароли не совпадают');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Обзор | Family Finance');
  });
});
