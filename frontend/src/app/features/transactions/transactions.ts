import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, ApiError, Members } from '../../core/api';
import { Localization } from '../../core/i18n/localization';
import { Workspace } from '../../core/workspace';
import { AccountsService } from '../accounts/accounts.service';
import { Account } from '../accounts/account.model';
import { CategoriesService, Category } from '../categories/categories.service';
import { decimalToMinor, formatMinor } from '../../shared/formatters/formatters';

type Kind = 'expense' | 'income' | 'transfer' | 'refund' | 'fee';
interface Row {
  id: string;
  type: Kind;
  transactionDate: string;
  status: 'posted' | 'void';
  version: number;
  authorMemberId: string;
  merchant: string | null;
  note: string | null;
  accountId?: string;
  categoryId?: string;
  amountMinor?: string;
  currency?: string;
  exchangeRate?: string | null;
  exchangeRateSource?: string | null;
  rsdEquivalentMinor?: string | null;
  fromAccountId?: string;
  toAccountId?: string;
  debitAmountMinor?: string;
  creditAmountMinor?: string;
  debitCurrency?: string;
  creditCurrency?: string;
  purchaseTransactionId?: string;
  parentTransactionId?: string;
  fee?: {
    amountMinor: string;
    categoryId: string;
    exchangeRate: string | null;
    exchangeRateSource: string | null;
  } | null;
}
interface Page {
  transactions: Row[];
  nextCursor: string | null;
}
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
})
export class Transactions {
  protected readonly api = inject(Api);
  protected readonly i18n = inject(Localization);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly workspace = inject(Workspace);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly members = signal<Members['members']>([]);
  protected readonly rows = signal<Row[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly purchases = signal<Row[]>([]);
  protected readonly purchaseCursor = signal<string | null>(null);
  protected readonly loadError = signal('');
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly selected = signal<Row | null>(null);
  protected readonly editing = signal(false);
  protected readonly review = signal<Row | null>(null);
  protected readonly active = computed(() => this.accounts().filter((a) => a.status === 'active'));
  protected readonly filters = this.fb.nonNullable.group({
    search: '',
    dateFrom: '',
    dateTo: '',
    type: '',
    categoryId: '',
    accountId: '',
    ownerMemberId: '',
    currency: '',
    status: '',
  });
  protected readonly form = this.fb.nonNullable.group({
    type: 'expense',
    transactionDate: '',
    accountId: '',
    categoryId: '',
    amount: '',
    exchangeRate: '',
    exchangeRateSource: '',
    merchant: '',
    note: '',
    fromAccountId: '',
    toAccountId: '',
    debitAmount: '',
    creditAmount: '',
    feeAmount: '',
    feeCategoryId: '',
    feeRate: '',
    feeRateSource: '',
    purchaseTransactionId: '',
  });
  protected readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  private appliedFilters: Record<string, string> = {};
  private generation = 0;
  private detailGeneration = 0;
  private listGeneration = 0;
  private purchaseGeneration = 0;
  private lastPayload = '';
  private key = '';
  constructor() {
    effect((onCleanup) => {
      const id = this.api.selectedId();
      const g = ++this.generation;
      onCleanup(() => {
        this.generation++;
        this.detailGeneration++;
        this.listGeneration++;
        this.purchaseGeneration++;
      });
      this.rows.set([]);
      this.accounts.set([]);
      this.categories.set([]);
      this.members.set([]);
      this.selected.set(null);
      this.editing.set(false);
      this.error.set('');
      this.loadError.set('');
      this.success.set('');
      this.busy.set(false);
      this.cursor.set(null);
      this.purchases.set([]);
      this.purchaseCursor.set(null);
      this.review.set(null);
      this.lastPayload = '';
      this.key = '';
      this.appliedFilters = {};
      this.form.reset();
      this.filters.reset();
      if (id) void this.initialize(id, g);
    });
  }
  private current(id: string, g: number) {
    return this.api.selectedId() === id && this.generation === g;
  }
  private async showError(e: unknown, id: string, g: number) {
    const message = await this.api.handleError(e);
    if (this.current(id, g)) this.error.set(message);
  }
  private base(id: string) {
    return `/households/${encodeURIComponent(id)}/transactions`;
  }
  private today(): string {
    const tz =
      this.api.session()?.households.find((h) => h.id === this.api.selectedId())?.timeZone ?? 'UTC';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
  private async initialize(id: string, g: number) {
    this.loading.set(true);
    try {
      const [a, c, m] = await Promise.all([
        this.accountsService.list(id),
        this.categoriesService.list(id),
        this.accountsService.members(id),
      ]);
      if (!this.current(id, g)) return;
      this.accounts.set(a.accounts);
      this.categories.set(c.categories);
      this.members.set(m.members);
      await this.load();
      if (
        this.current(id, g) &&
        this.route.snapshot.queryParamMap.has('create') &&
        this.active().length
      )
        this.create();
    } catch (e) {
      if (this.current(id, g)) {
        const message = await this.api.handleError(e);
        if (this.current(id, g)) this.loadError.set(message);
      }
    } finally {
      if (this.current(id, g)) this.loading.set(false);
    }
  }
  protected retry() {
    const id = this.api.selectedId();
    if (id) void this.initialize(id, this.generation);
  }
  protected async load(more = false) {
    const id = this.api.selectedId();
    if (!id || (more && !this.cursor())) return;
    const g = this.generation,
      n = ++this.listGeneration;
    this.loading.set(true);
    this.loadError.set('');
    const params = new URLSearchParams();
    if (!more) {
      this.appliedFilters = this.filters.getRawValue();
      this.cursor.set(null);
    }
    for (const [k, v] of Object.entries(this.appliedFilters)) if (v.trim()) params.set(k, v.trim());
    params.set('limit', '50');
    if (more) params.set('cursor', this.cursor()!);
    try {
      const page = await this.api.request<Page>(`${this.base(id)}?${params}`);
      if (!this.current(id, g) || n !== this.listGeneration) return;
      this.rows.update((old) =>
        more
          ? [...old, ...page.transactions.filter((r) => !old.some((x) => x.id === r.id))]
          : page.transactions,
      );
      this.cursor.set(page.nextCursor);
    } catch (e) {
      if (this.current(id, g) && n === this.listGeneration) {
        const message = await this.api.handleError(e);
        if (this.current(id, g) && n === this.listGeneration) this.loadError.set(message);
      }
    } finally {
      if (this.current(id, g) && n === this.listGeneration) this.loading.set(false);
    }
  }
  protected async loadPurchases(more = false) {
    const id = this.api.selectedId();
    if (!id || (more && !this.purchaseCursor())) return;
    const g = this.generation,
      n = ++this.purchaseGeneration;
    const p = new URLSearchParams({ type: 'expense', status: 'posted', limit: '50' });
    if (more) p.set('cursor', this.purchaseCursor()!);
    try {
      const page = await this.api.request<Page>(`${this.base(id)}?${p}`);
      if (!this.current(id, g) || n !== this.purchaseGeneration) return;
      this.purchases.update((old) =>
        more
          ? [...old, ...page.transactions.filter((r) => !old.some((x) => x.id === r.id))]
          : page.transactions,
      );
      this.purchaseCursor.set(page.nextCursor);
    } catch (e) {
      if (this.current(id, g) && n === this.purchaseGeneration) {
        const message = await this.api.handleError(e);
        if (this.current(id, g) && n === this.purchaseGeneration) this.error.set(message);
      }
    }
  }
  protected account(id?: string) {
    return this.accounts().find((a) => a.id === id);
  }
  protected category(id?: string) {
    return this.categories().find((c) => c.id === id)?.name ?? '—';
  }
  protected member(id: string) {
    return this.members().find((m) => m.id === id)?.email ?? this.i18n.t('Former member');
  }
  protected money(value?: string, currency?: string) {
    return value && currency ? formatMinor(value, currency, this.i18n.locale()) : '—';
  }
  protected minorToDecimal(value?: string) {
    if (!value) return '';
    const s = value.padStart(3, '0');
    return `${s.slice(0, -2)}.${s.slice(-2)}`;
  }
  protected label(row: Row) {
    return row.merchant || this.category(row.categoryId) || this.i18n.t(row.type);
  }
  protected amount(row: Row) {
    return row.type === 'transfer'
      ? `${this.money(row.debitAmountMinor, row.debitCurrency)} → ${this.money(row.creditAmountMinor, row.creditCurrency)}`
      : this.money(row.amountMinor, row.currency);
  }
  private focusPanel() {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.detail h2')?.focus());
  }
  protected create() {
    if (this.busy() || this.editing() || !this.active().length) return;
    this.detailGeneration++;
    this.selected.set(null);
    this.review.set(null);
    this.error.set('');
    this.editing.set(true);
    const id = this.api.selectedId()!;
    const member = this.api.session()?.households.find((h) => h.id === id)?.memberId ?? '';
    let saved = '';
    try {
      saved = localStorage.getItem(`transaction-account:${id}:${member}`) ?? '';
    } catch {}
    const account = this.active().find((a) => a.id === saved) ?? this.active()[0];
    this.focusPanel();
    this.form.reset({
      type: 'expense',
      transactionDate: this.today(),
      accountId: account.id,
      categoryId: '',
      amount: '',
      exchangeRate: '',
      exchangeRateSource: '',
      merchant: '',
      note: '',
      fromAccountId: account.id,
      toAccountId: '',
      debitAmount: '',
      creditAmount: '',
      feeAmount: '',
      feeCategoryId: '',
      feeRate: '',
      feeRateSource: '',
      purchaseTransactionId: '',
    });
  }
  protected async open(row: Row) {
    if (this.busy() || this.editing()) return;
    const id = this.api.selectedId();
    if (!id) return;
    const g = this.generation,
      d = ++this.detailGeneration;
    try {
      const fresh = await this.api.request<Row>(`${this.base(id)}/${encodeURIComponent(row.id)}`);
      if (this.current(id, g) && d === this.detailGeneration) {
        this.selected.set(fresh);
        this.editing.set(false);
        this.review.set(null);
        this.focusPanel();
      }
    } catch (e) {
      if (this.current(id, g) && d === this.detailGeneration) {
        const message = await this.api.handleError(e);
        if (this.current(id, g) && d === this.detailGeneration) this.error.set(message);
      }
    }
  }
  protected openParent(id: string) {
    const row = this.rows().find((r) => r.id === id);
    void this.open(
      row ?? {
        id,
        type: 'transfer',
        transactionDate: '',
        status: 'posted',
        version: 1,
        authorMemberId: '',
        merchant: null,
        note: null,
      },
    );
  }
  protected edit(row: Row) {
    if (this.busy() || this.editing() || row.type === 'fee') return;
    this.detailGeneration++;
    this.selected.set(row);
    this.review.set(null);
    this.editing.set(true);
    this.form.reset({
      type: row.type,
      transactionDate: row.transactionDate,
      accountId: row.accountId ?? '',
      categoryId: row.categoryId ?? '',
      amount: this.minorToDecimal(row.amountMinor),
      exchangeRate: row.exchangeRate ?? '',
      exchangeRateSource: row.exchangeRateSource ?? '',
      merchant: row.merchant ?? '',
      note: row.note ?? '',
      fromAccountId: row.fromAccountId ?? '',
      toAccountId: row.toAccountId ?? '',
      debitAmount: this.minorToDecimal(row.debitAmountMinor),
      creditAmount: this.minorToDecimal(row.creditAmountMinor),
      feeAmount: this.minorToDecimal(row.fee?.amountMinor),
      feeCategoryId: row.fee?.categoryId ?? '',
      feeRate: row.fee?.exchangeRate ?? '',
      feeRateSource: row.fee?.exchangeRateSource ?? '',
      purchaseTransactionId: row.purchaseTransactionId ?? '',
    });
    this.focusPanel();
    if (row.type === 'refund') void this.loadPurchases();
  }
  protected kindChanged() {
    if (this.form.controls.type.value === 'refund') void this.loadPurchases();
  }
  protected archivedCategory(id?: string) {
    return this.categories().some((c) => c.id === id && c.status === 'archived');
  }
  protected eligible(type: string | undefined) {
    return this.categories().filter((c) => c.status === 'active' && c.type === type);
  }
  protected purchase() {
    this.formValue();
    return this.purchases().find((p) => p.id === this.form.controls.purchaseTransactionId.value);
  }
  protected inheritedPurchase() {
    return this.purchase() ?? (this.selected()?.type === 'refund' ? this.selected() : null);
  }
  protected async save() {
    if (this.busy() || this.review()) return;
    const id = this.api.selectedId();
    if (!id) return;
    const v = this.form.getRawValue(),
      row = this.selected();
    const amount = (s: string) => decimalToMinor(s, false, this.i18n.locale());
    const positive = (s: string | null) =>
      s !== null && BigInt(s) > 0n && BigInt(s) <= BigInt(Number.MAX_SAFE_INTEGER);
    const account = this.account(v.accountId),
      from = this.account(v.fromAccountId),
      to = this.account(v.toAccountId);
    let body: Record<string, unknown>;
    const common = {
      transactionDate: v.transactionDate,
      merchant: v.merchant.trim() || null,
      note: v.note.trim() || null,
    };
    if (!v.transactionDate) {
      this.error.set('Enter a date.');
      return;
    }
    if (v.type === 'transfer') {
      const d = amount(v.debitAmount),
        c = amount(v.creditAmount),
        f = v.feeAmount ? amount(v.feeAmount) : null;
      if (
        !from ||
        !to ||
        from.status !== 'active' ||
        to.status !== 'active' ||
        from.id === to.id ||
        !positive(d) ||
        !positive(c) ||
        (from.currency === to.currency && d !== c) ||
        (v.feeAmount &&
          (!positive(f) || !this.eligible('expense').some((x) => x.id === v.feeCategoryId))) ||
        (v.feeAmount && from.currency !== 'RSD' && (!v.feeRate.trim() || !v.feeRateSource.trim()))
      ) {
        this.error.set('Check the accounts, amounts, fee and exchange rate.');
        return;
      }
      body = {
        type: 'transfer',
        ...common,
        fromAccountId: from.id,
        toAccountId: to.id,
        debitAmountMinor: d,
        creditAmountMinor: c,
        debitCurrency: from.currency,
        creditCurrency: to.currency,
        fee: v.feeAmount
          ? {
              amountMinor: f,
              categoryId: v.feeCategoryId,
              exchangeRate: from.currency === 'RSD' ? null : v.feeRate.trim(),
              exchangeRateSource: from.currency === 'RSD' ? null : v.feeRateSource.trim(),
            }
          : null,
      };
    } else if (v.type === 'refund') {
      const purchase = this.purchase();
      const currency = purchase?.currency ?? (row?.type === 'refund' ? row.currency : undefined);
      const a = amount(v.amount);
      if (
        !account ||
        account.status !== 'active' ||
        !currency ||
        account.currency !== currency ||
        !positive(a) ||
        !v.purchaseTransactionId
      ) {
        this.error.set('Choose a posted purchase, a matching active account and a valid amount.');
        return;
      }
      body = {
        type: 'refund',
        ...common,
        purchaseTransactionId: v.purchaseTransactionId,
        accountId: account.id,
        amountMinor: a,
      };
    } else {
      const a = amount(v.amount);
      if (
        !account ||
        account.status !== 'active' ||
        !positive(a) ||
        !this.eligible(v.type).some((x) => x.id === v.categoryId) ||
        (account.currency !== 'RSD' && (!v.exchangeRate.trim() || !v.exchangeRateSource.trim()))
      ) {
        this.error.set('Check the account, category, amount and exchange rate.');
        return;
      }
      body = {
        type: v.type,
        ...common,
        accountId: account.id,
        categoryId: v.categoryId,
        amountMinor: a,
        currency: account.currency,
        exchangeRate: account.currency === 'RSD' ? null : v.exchangeRate.trim(),
        exchangeRateSource: account.currency === 'RSD' ? null : v.exchangeRateSource.trim(),
      };
    }
    const serialized = JSON.stringify(body);
    if (serialized !== this.lastPayload) {
      this.key = crypto.randomUUID();
      this.lastPayload = serialized;
    }
    const g = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await this.api.request<Row>(
        row ? `${this.base(id)}/${encodeURIComponent(row.id)}` : this.base(id),
        row ? 'PATCH' : 'POST',
        row ? { ...body, version: row.version } : body,
        row ? undefined : { 'Idempotency-Key': this.key },
      );
      if (!this.current(id, g)) return;
      try {
        const member = this.api.session()?.households.find((h) => h.id === id)?.memberId ?? '';
        localStorage.setItem(
          `transaction-account:${id}:${member}`,
          v.type === 'transfer' ? v.fromAccountId : v.accountId,
        );
      } catch {}
      this.selected.set(saved);
      this.editing.set(false);
      this.lastPayload = '';
      this.success.set('Transaction saved.');
      void this.workspace.load(id);
      await this.load();
    } catch (e) {
      if (!this.current(id, g)) return;
      if (
        row &&
        e instanceof ApiError &&
        ['VERSION_CONFLICT', 'REFUND_CONFLICT'].includes(e.code)
      ) {
        try {
          const fresh = await this.api.request<Row>(
            `${this.base(id)}/${encodeURIComponent(row.id)}`,
          );
          if (this.current(id, g) && fresh.version !== row.version) {
            this.review.set(fresh);
            this.error.set('This transaction changed. Review the current version before retrying.');
          } else if (this.current(id, g)) {
            const message = await this.api.handleError(e);
            if (this.current(id, g)) this.error.set(message);
          }
        } catch {
          await this.showError(e, id, g);
        }
      } else await this.showError(e, id, g);
    } finally {
      if (this.current(id, g)) this.busy.set(false);
    }
  }
  protected acknowledge() {
    const r = this.review();
    if (r && r.status === 'posted') {
      this.selected.set(r);
      this.review.set(null);
      this.error.set('');
    }
  }
  protected async voidRow(row: Row) {
    if (this.busy() || !confirm(this.i18n.t('Void this transaction?'))) return;
    const id = this.api.selectedId();
    if (!id) return;
    const g = this.generation;
    this.busy.set(true);
    try {
      const saved = await this.api.request<Row>(
        `${this.base(id)}/${encodeURIComponent(row.id)}/void`,
        'POST',
        { version: row.version },
      );
      if (this.current(id, g)) {
        this.selected.set(saved);
        this.success.set('Transaction voided.');
        void this.workspace.load(id);
        await this.load();
      }
    } catch (e) {
      if (this.current(id, g)) {
        if (e instanceof ApiError && ['VERSION_CONFLICT', 'REFUND_CONFLICT'].includes(e.code)) {
          const fresh = await this.api
            .request<Row>(`${this.base(id)}/${encodeURIComponent(row.id)}`)
            .catch(() => null);
          if (!fresh) {
            if (this.current(id, g)) this.error.set('Unable to load the current transaction.');
            return;
          }
          if (this.current(id, g) && fresh.version !== row.version) {
            this.selected.set(fresh);
            this.error.set('This transaction changed. Review the current version before retrying.');
          } else await this.showError(e, id, g);
        } else await this.showError(e, id, g);
      }
    } finally {
      if (this.current(id, g)) this.busy.set(false);
    }
  }
}
