import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ApiError } from '../../core/api';
import { Localization } from '../../core/i18n/localization';
import { Workspace } from '../../core/workspace';
import { CategoriesService, Category } from '../categories/categories.service';
import { decimalToMinor, formatMinor } from '../../shared/formatters/formatters';
import { containDialogFocus, openCreationDialog } from '../../shared/ui/creation-dialog';

export interface Plan {
  id: string;
  month: string;
  categoryId: string;
  categoryName: string;
  categoryStatus: 'active' | 'archived';
  limitMinor: string;
  actualMinor: string;
  remainingMinor: string | null;
  overspentMinor: string | null;
  utilizationBasisPoints: string | null;
  missingFxCount: number;
}
export function percent(basisPoints: string, locale = 'en-US'): string {
  const value = BigInt(basisPoints);
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ??
    '.';
  return `${value < 0n ? '−' : ''}${grouped}${fraction ? decimal + fraction : ''}%`;
}
export function progress(basisPoints: string): number {
  const v = BigInt(basisPoints);
  return v <= 0n ? 0 : v >= 10000n ? 100 : Number(v) / 100;
}
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './budgets.html',
  styleUrl: './budgets.css',
})
export class Budgets {
  protected api = inject(Api);
  protected i18n = inject(Localization);
  private categoriesService = inject(CategoriesService);
  private workspace = inject(Workspace);
  private fb = inject(FormBuilder);
  private dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  protected containFocus = containDialogFocus;
  protected rows = signal<Plan[]>([]);
  protected categories = signal<Category[]>([]);
  protected month = signal('');
  protected loading = signal(false);
  protected categoryLoading = signal(false);
  protected categoryError = signal(false);
  protected busy = signal(false);
  protected loadError = signal('');
  protected error = signal('');
  protected success = signal('');
  protected editing = signal<Plan | null>(null);
  protected opened = signal(false);
  protected available = computed(() =>
    this.categories().filter((c) => !this.rows().some((p) => p.categoryId === c.id)),
  );
  protected form = this.fb.nonNullable.group({ categoryId: '', amount: '' });
  private generation = 0;
  private request = 0;
  private categoryRequest = 0;
  private opener: HTMLElement | null = null;
  constructor() {
    effect((onCleanup) => {
      const id = this.api.selectedId(),
        g = ++this.generation;
      onCleanup(() => {
        this.generation++;
        this.request++;
        this.categoryRequest++;
      });
      untracked(() => this.close(undefined, true));
      this.rows.set([]);
      this.categories.set([]);
      this.month.set('');
      this.error.set('');
      this.loadError.set('');
      this.success.set('');
      this.loading.set(false);
      this.categoryLoading.set(false);
      this.categoryError.set(false);
      this.busy.set(false);
      if (id) {
        void this.load(id, g);
        void this.loadCategories(id, g);
      }
    });
  }
  private current(id: string, g: number, n: number) {
    return this.api.selectedId() === id && this.generation === g && this.request === n;
  }
  private base(id: string) {
    return `/households/${encodeURIComponent(id)}/plans`;
  }
  private async load(id: string, g: number, month?: string) {
    const n = ++this.request;
    this.loading.set(true);
    this.loadError.set('');
    this.rows.set([]);
    try {
      const p = await this.api.request<{ month: string; plans: Plan[] }>(
        `${this.base(id)}${month ? '?month=' + encodeURIComponent(month) : ''}`,
      );
      if (this.current(id, g, n)) {
        this.month.set(p.month);
        this.rows.set(p.plans);
      }
    } catch (e) {
      const message = await this.api.handleError(e);
      if (this.current(id, g, n)) this.loadError.set(message);
    } finally {
      if (this.current(id, g, n)) this.loading.set(false);
    }
  }
  private async loadCategories(id: string, g: number) {
    const n = ++this.categoryRequest;
    this.categoryLoading.set(true);
    this.categoryError.set(false);
    try {
      const result = await this.categoriesService.listEligible(id, 'budget');
      if (this.api.selectedId() === id && this.generation === g && this.categoryRequest === n)
        this.categories.set(result.categories);
    } catch {
      if (this.api.selectedId() === id && this.generation === g && this.categoryRequest === n) {
        this.categories.set([]);
        this.categoryError.set(true);
      }
    } finally {
      if (this.api.selectedId() === id && this.generation === g && this.categoryRequest === n)
        this.categoryLoading.set(false);
    }
  }
  protected retryCategories() {
    const id = this.api.selectedId();
    if (id) void this.loadCategories(id, this.generation);
  }
  protected retry() {
    const id = this.api.selectedId();
    if (id) void this.load(id, this.generation, this.month() || undefined);
  }
  protected changeMonth(event: Event) {
    const m = (event.target as HTMLInputElement).value;
    this.month.set(m);
    this.success.set('');
    this.request++;
    this.rows.set([]);
    this.loadError.set('');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
      this.loading.set(false);
      return;
    }
    const id = this.api.selectedId();
    if (id) void this.load(id, this.generation, m);
  }
  protected money(v: string) {
    return formatMinor(v, 'RSD', this.i18n.locale());
  }
  protected percent(v: string) {
    return percent(v, this.i18n.locale());
  }
  protected progress = progress;
  protected start(event: Event, row?: Plan) {
    if (this.busy() || this.loading() || (!row && !this.available().length)) return;
    this.opener = event.currentTarget as HTMLElement;
    this.editing.set(row ?? null);
    this.error.set('');
    const s = row?.limitMinor.padStart(3, '0');
    this.form.reset({
      categoryId: row?.categoryId ?? this.available()[0]?.id ?? '',
      amount: s ? `${s.slice(0, -2)}.${s.slice(-2)}` : '',
    });
    this.opened.set(true);
    openCreationDialog(this.dialog()?.nativeElement);
  }
  protected close(event?: Event, force = false) {
    event?.preventDefault();
    if (this.busy() && !force) return;
    if (!this.opened()) return;
    this.opened.set(false);
    this.dialog()?.nativeElement.close();
    this.error.set('');
    const opener = this.opener;
    this.opener = null;
    requestAnimationFrame(() =>
      (opener?.isConnected ? opener : document.querySelector<HTMLElement>('.pagehead h1'))?.focus(),
    );
  }
  protected async save() {
    const id = this.api.selectedId(),
      row = this.editing(),
      month = this.month(),
      v = this.form.getRawValue();
    if (!id || !this.opened() || this.busy()) return;
    const amount = decimalToMinor(v.amount, false, this.i18n.locale());
    if (
      amount === null ||
      BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER) ||
      (!row && !this.available().some((c) => c.id === v.categoryId))
    ) {
      this.error.set('Enter a valid nonnegative limit and choose a category.');
      return;
    }
    const g = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.request(
        row ? `${this.base(id)}/${encodeURIComponent(row.id)}` : this.base(id),
        row ? 'PATCH' : 'POST',
        row ? { limitMinor: amount } : { month, categoryId: v.categoryId, limitMinor: amount },
      );
      if (this.api.selectedId() !== id || this.generation !== g) return;
      this.busy.set(false);
      this.close();
      this.success.set(row ? 'Budget updated.' : 'Budget added.');
      void this.workspace.load(id);
      await this.load(id, g, month);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === 'PLAN_EXISTS'
          ? 'A budget already exists for this category and month.'
          : await this.api.handleError(e);
      if (this.api.selectedId() === id && this.generation === g) this.error.set(msg);
    } finally {
      if (this.api.selectedId() === id && this.generation === g) this.busy.set(false);
    }
  }
  protected async remove(row: Plan) {
    const id = this.api.selectedId();
    if (!id || this.busy() || !confirm(this.i18n.t('Delete this budget?'))) return;
    const g = this.generation,
      m = this.month();
    this.busy.set(true);
    this.success.set('');
    this.loadError.set('');
    try {
      await this.api.request(`${this.base(id)}/${encodeURIComponent(row.id)}`, 'DELETE');
      if (this.api.selectedId() !== id || this.generation !== g) return;
      this.success.set('Budget deleted.');
      void this.workspace.load(id);
      await this.load(id, g, m);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === 'PLAN_LINKED'
          ? 'This budget is linked to other records and cannot be deleted.'
          : await this.api.handleError(e);
      if (this.api.selectedId() === id && this.generation === g) this.loadError.set(msg);
    } finally {
      if (this.api.selectedId() === id && this.generation === g) this.busy.set(false);
    }
  }
}
