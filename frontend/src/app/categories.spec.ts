import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { Api } from './api';
import { Categories } from './categories';
import { CategoriesService, Category } from './categories.service';

beforeEach(() => localStorage.setItem('family-finance-language', 'en'));
afterEach(() => localStorage.removeItem('family-finance-language'));
const row = (name: string, status: 'active' | 'archived' = 'active'): Category => ({
  id: '1',
  name,
  type: 'expense',
  status,
  createdAt: '',
  updatedAt: '',
});
describe('categories', () => {
  it('creates, renames, archives and resets a no-match filter', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const api = TestBed.inject(Api);
    const service = TestBed.inject(CategoriesService);
    vi.spyOn(service, 'list').mockResolvedValue({ categories: [] });
    vi.spyOn(service, 'referenceNames').mockResolvedValue({ expense: ['Groceries'], income: [] });
    const create = vi.spyOn(service, 'create').mockResolvedValue(row('Groceries'));
    const update = vi
      .spyOn(service, 'update')
      .mockResolvedValueOnce(row('Food'))
      .mockResolvedValueOnce(row('Food', 'archived'));
    api.selectedId.set('home');
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Groceries');
    });
    const button = (text: string) =>
      Array.from(
        fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
      ).find((b) => b.textContent?.trim() === text)!;
    button('Groceries').click();
    fixture.detectChanges();
    expect(create).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith('home', 'Groceries', 'expense'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Rename')).toBeTruthy();
    });
    button('Rename').click();
    fixture.detectChanges();
    const edit = fixture.nativeElement.querySelector('.category-row input') as HTMLInputElement;
    edit.value = ' Food ';
    edit.dispatchEvent(new Event('input'));
    fixture.nativeElement.querySelector('.category-row form').dispatchEvent(new Event('submit'));
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith('home', '1', { name: 'Food' }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Archive')).toBeTruthy();
    });
    button('Archive').click();
    await vi.waitFor(() =>
      expect(update).toHaveBeenCalledWith('home', '1', { status: 'archived' }),
    );
    fixture.detectChanges();
    const search = fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'missing';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No results match');
    button('Reset filters').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Food');
  });
  it('ignores a previous household response', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const api = TestBed.inject(Api);
    const service = TestBed.inject(CategoriesService);
    let resolve!: (value: { categories: Category[] }) => void;
    vi.spyOn(service, 'list').mockImplementation((id) =>
      id === 'first'
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({ categories: [row('Second')] }),
    );
    vi.spyOn(service, 'referenceNames').mockResolvedValue({ expense: [], income: [] });
    api.selectedId.set('first');
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    api.selectedId.set('second');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Second');
    });
    resolve({ categories: [row('First')] });
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('First');
  });
  it('requests eligible options with the required usage', async () => {
    const api = TestBed.inject(Api);
    const request = vi.spyOn(api, 'request').mockResolvedValue({ usage: 'fee', categories: [] });
    await TestBed.inject(CategoriesService).listEligible('house hold', 'fee');
    expect(request).toHaveBeenCalledWith('/households/house%20hold/categories/options?usage=fee');
  });
});
