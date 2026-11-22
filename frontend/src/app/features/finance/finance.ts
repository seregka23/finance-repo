import { formatCalendarDate, formatMinor } from '../../shared/formatters/formatters';
import { Localization } from '../../core/i18n/localization';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  viewChild,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Workspace } from '../../core/workspace';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CategoriesService, Category } from '../categories/categories.service';

interface Balance {
  currency: string;
  balanceMinor: string;
  reservedMinor: string;
  availableMinor: string;
}
interface Flow {
  incomeMinor: string;
  expenseMinor: string;
  netMinor: string;
}
interface Totals extends Flow {
  missingFxCount: number;
  originalCurrencies: (Flow & { currency: string })[];
}
interface Recent {
  id: string;
  transactionDate: string;
  type: string;
  merchant: string | null;
  categoryName: string | null;
  amountMinor: string | null;
  currency: string | null;
  accountName: string | null;
  toAccountName?: string | null;
  creditAmountMinor?: string | null;
  creditCurrency?: string | null;
}
interface Dashboard {
  month: string;
  totals: Totals;
  balances: Balance[];
  recentTransactions: Recent[];
}
interface Breakdown {
  name: string | null;
  expenseMinor: string;
  missingFxCount: number;
}
interface Monthly {
  month: string;
  monthTransactionCount: number;
  matchedTransactionCount: number;
  totals: Totals;
  balances: Balance[];
  byCategory: (Breakdown & { categoryId: string })[];
  byMerchant: Breakdown[];
}
@Component({
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './finance.html',
  styleUrl: './finance.css',
})
export class Finance implements OnDestroy {
  protected readonly i18n = inject(Localization);
  protected readonly api = inject(Api);
  protected zero(currency: string): string {
    return formatMinor('0', currency, this.i18n.locale());
  }
  protected readonly workspace = inject(Workspace);
  private readonly route = inject(ActivatedRoute);
  protected readonly page = this.route.snapshot.data['page'] as string;
  protected readonly household = computed(
    () => this.api.session()?.households.find((h) => h.id === this.api.selectedId()) ?? null,
  );
  protected readonly month = computed(() =>
    new Intl.DateTimeFormat(this.i18n.locale(), {
      month: 'long',
      year: 'numeric',
      timeZone: this.household()?.timeZone ?? 'UTC',
    }).format(new Date()),
  );
  private readonly categoriesService = inject(CategoriesService);
  private readonly fb = inject(FormBuilder);
  protected readonly filters = this.fb.nonNullable.group({
    month: '',
    categoryId: '',
    merchant: '',
  });
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly report = signal<Monthly | null>(null);
  protected readonly reportLoading = signal(false);
  protected readonly reportError = signal('');
  protected readonly categories = signal<Category[]>([]);
  protected readonly categoryError = signal(false);
  protected readonly applied = signal(false);
  private generation = 0;
  private request = 0;
  private categoryRequest = 0;
  private appliedValues = { month: '', categoryId: '', merchant: '' };
  protected date(value: string) { return formatCalendarDate(value, this.i18n.locale()); }
  protected monthTitle(value: string) { return new Intl.DateTimeFormat(this.i18n.locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + '-01T00:00:00Z')); }
  protected money(v: string | null | undefined, currency: string | null | undefined) {
    return v != null && currency ? formatMinor(v, currency, this.i18n.locale()) : '—';
  }
  private base(id: string) {
    return `/households/${encodeURIComponent(id)}`;
  }
  private current(id: string, g: number, n: number) {
    return this.api.selectedId() === id && this.generation === g && this.request === n;
  }
  private async loadReport(id: string, g: number) {
    const n = ++this.request;
    this.reportLoading.set(true);
    this.reportError.set('');
    this.dashboard.set(null);
    this.report.set(null);
    const p = new URLSearchParams();
    if (this.page === 'Reports') {
      for (const [k, v] of Object.entries(this.appliedValues)) if (v.trim()) p.set(k, v.trim());
    }
    try {
      if (this.page === 'Dashboard') {
        const data = await this.api.request<Dashboard>(`${this.base(id)}/dashboard`);
        if (this.current(id, g, n)) this.dashboard.set(data);
      } else {
        const data = await this.api.request<Monthly>(
          `${this.base(id)}/reports/monthly${p.size ? '?' + p : ''}`,
        );
        if (this.current(id, g, n)) {
          this.report.set(data);
          if (!this.appliedValues.month) {
            this.filters.controls.month.setValue(data.month);
            this.appliedValues.month = data.month;
          }
        }
      }
    } catch (e) {
      const message = await this.api.handleError(e);
      if (this.current(id, g, n)) this.reportError.set(message);
    } finally {
      if (this.current(id, g, n)) this.reportLoading.set(false);
    }
  }
  private async loadCategories(id: string, g: number) {
    const n = ++this.categoryRequest;
    this.categoryError.set(false);
    try {
      const c = await this.categoriesService.list(id);
      if (this.api.selectedId() === id && this.generation === g && this.categoryRequest === n)
        this.categories.set(c.categories);
    } catch {
      if (this.api.selectedId() === id && this.generation === g && this.categoryRequest === n)
        this.categoryError.set(true);
    }
  }
  protected retryCategories() {
    const id = this.api.selectedId();
    if (id) void this.loadCategories(id, this.generation);
  }
  protected retryReport() {
    const id = this.api.selectedId();
    if (id) void this.loadReport(id, this.generation);
  }
  protected apply() {
    const v = this.filters.getRawValue();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month)) {
      this.reportError.set('Choose a valid month.');
      return;
    }
    this.appliedValues = v;
    this.applied.set(!!(v.categoryId || v.merchant.trim()));
    this.retryReport();
  }
  protected reset() {
    this.filters.patchValue({ categoryId: '', merchant: '' });
    this.apply();
  }
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('chooser');
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
      untracked(() => this.close());
      this.dashboard.set(null);
      this.report.set(null);
      this.reportError.set('');
      this.categories.set([]);
      this.categoryError.set(false);
      this.reportLoading.set(false);
      this.applied.set(false);
      this.appliedValues = { month: '', categoryId: '', merchant: '' };
      this.filters.reset();
      if (id) {
        void this.loadReport(id, g);
        if (this.page === 'Reports') void this.loadCategories(id, g);
      }
    });
  }
  protected open(event: Event): void {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog || dialog.open) return;
    this.opener = event.currentTarget as HTMLElement;
    dialog.showModal();
  }
  protected containFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.dialog()?.nativeElement;
    if (!dialog?.open) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
  protected close(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
  protected restore(): void {
    if (this.opener?.isConnected) this.opener.focus();
    this.opener = null;
  }
  ngOnDestroy(): void {
    this.close();
  }
}
