import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, ApiError } from '../../core/api';
import { Localization } from '../../core/i18n/localization';
import { Workspace } from '../../core/workspace';
import { Account } from '../accounts/account.model';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService, Category } from '../categories/categories.service';
import { decimalToMinor, formatMinor } from '../../shared/formatters/formatters';

type Source = 'sms' | 'screenshot' | 'receipt';
type Kind = 'expense' | 'income' | 'transfer' | 'refund';
interface Item {
  name: string | null;
  quantity: string | null;
  unitPriceMinor: string | null;
  amountMinor: string | null;
}
interface Extracted {
  type: Kind | null;
  status: 'posted' | 'pending' | 'unknown' | 'declined';
  date: string | null;
  amountMinor: string | null;
  currency: string | null;
  merchant: string | null;
  recipient: string | null;
  feeMinor: string | null;
  purchaseAmountMinor: string | null;
  purchaseCurrency: string | null;
  debitAmountMinor: string | null;
  debitCurrency: string | null;
  items: Item[];
}
interface Summary {
  id: string;
  status: string;
  sourceType: Source;
  transactionId: string | null;
  createdAt: string;
}
interface Draft extends Summary {
  draft: Extracted;
  categoryDecision: { categoryId: string | null };
  reviewFlags: string[];
  suggestedAccountId: string | null;
  possibleDuplicates: {
    id: string;
    transactionDate: string;
    amountMinor: string;
    currency: string;
    merchant: string | null;
  }[];
}
interface Expense {
  id: string;
  transactionDate: string;
  amountMinor?: string;
  currency?: string;
  merchant: string | null;
  status: string;
}
interface ExpensePage {
  transactions: Expense[];
  nextCursor: string | null;
}

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './import-review.html',
  styleUrl: './import-review.css',
})
export class ImportReview {
  protected readonly api = inject(Api);
  protected readonly i18n = inject(Localization);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly workspace = inject(Workspace);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly drafts = signal<Summary[]>([]);
  protected readonly current = signal<Draft | null>(null);
  protected readonly expenses = signal<Expense[]>([]);
  protected readonly expenseCursor = signal<string | null>(null);
  protected readonly attachmentOptions = computed(() => {
    const matches = this.current()?.possibleDuplicates ?? [];
    const matchIds = new Set(matches.map((match) => match.id));
    return [...matches, ...this.expenses().filter((expense) => !matchIds.has(expense.id))];
  });
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly retryKind = signal<'load' | 'preview' | ''>('');
  protected readonly success = signal('');
  protected readonly active = computed(() => this.accounts().filter((a) => a.status === 'active'));
  protected readonly source = this.fb.nonNullable.group({ sourceType: 'sms' as Source, text: '' });
  protected readonly form = this.fb.nonNullable.group({
    type: '' as Kind | '',
    date: '',
    accountId: '',
    fromAccountId: '',
    toAccountId: '',
    amount: '',
    debitAmount: '',
    creditAmount: '',
    categoryId: '',
    merchant: '',
    note: '',
    exchangeRate: '',
    exchangeRateSource: '',
    fee: '',
    feeCategoryId: '',
    feeRate: '',
    feeRateSource: '',
    purchaseTransactionId: '',
    existingExpenseId: '',
    settlementConfirmed: false,
    keepSeparate: false,
  });
  protected readonly items = new FormArray<ReturnType<ImportReview['itemGroup']>>([]);
  private readonly fileInputs = viewChildren<ElementRef<HTMLInputElement>>('sourceFile');
  private file: File | null = null;
  private lastSource: object | null = null;
  private generation = 0;
  private pendingDraft = this.route.snapshot.queryParamMap.get('draft');
  private readonly intentHousehold = this.api.selectedId();
  constructor() {
    effect((cleanup) => {
      const id = this.api.selectedId();
      const g = ++this.generation;
      if (this.pendingDraft && id !== this.intentHousehold) this.pendingDraft = null;
      cleanup(() => {
        this.generation++;
      });
      this.accounts.set([]);
      this.categories.set([]);
      this.drafts.set([]);
      this.current.set(null);
      this.expenses.set([]);
      this.expenseCursor.set(null);
      this.file = null;
      this.lastSource = null;
      this.source.reset({ sourceType: 'sms', text: '' });
      this.items.clear();
      this.form.reset();
      this.error.set('');
      this.retryKind.set('');
      this.success.set('');
      this.busy.set(false);
      this.loading.set(false);
      if (id) void this.initialize(id, g);
    });
  }
  private valid(id: string, g: number) {
    return this.api.selectedId() === id && this.generation === g;
  }
  private base(id: string) {
    return `/households/${encodeURIComponent(id)}/imports`;
  }
  private async report(e: unknown, id: string, g: number) {
    const messages: Record<string, string> = {
      EXTRACTION_NOT_CONFIGURED: 'Recognition is not configured. Enter the transaction manually.',
      EXTRACTION_UNREADABLE: 'The source could not be read. Try clearer text or another image.',
      EXTRACTION_UNAVAILABLE:
        'Recognition is unavailable. Try again or enter the transaction manually.',
      EXTRACTION_INVALID_RESPONSE:
        'Recognition could not interpret this source. Try another image or enter manually.',
      IMPORT_CONFLICT:
        'This draft cannot be confirmed as submitted. Reload it and review the details.',
      IMPORT_NOT_FOUND: 'This draft was not found. Return to the saved drafts list.',
    };
    const message =
      e instanceof ApiError && messages[e.code] ? messages[e.code] : await this.api.handleError(e);
    if (this.valid(id, g)) this.error.set(message);
  }
  protected async initialize(id = this.api.selectedId()!, g = this.generation) {
    if (!id) return;
    this.loading.set(true);
    this.error.set('');
    this.retryKind.set('');
    try {
      const [a, c, d] = await Promise.all([
        this.accountsService.list(id),
        this.categoriesService.list(id),
        this.api.request<{ drafts: Summary[] }>(this.base(id)),
      ]);
      if (!this.valid(id, g)) return;
      this.accounts.set(a.accounts);
      this.categories.set(c.categories);
      this.drafts.set(d.drafts);
      await this.loadExpenses(false, id, g);
      const pending = this.pendingDraft;
      this.pendingDraft = null;
      if (pending && this.valid(id, g)) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { draft: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        await this.open(pending);
      }
    } catch (e) {
      if (this.valid(id, g)) {
        this.retryKind.set('load');
        await this.report(e, id, g);
      }
    } finally {
      if (this.valid(id, g)) this.loading.set(false);
    }
  }
  protected async loadExpenses(more = false, id = this.api.selectedId()!, g = this.generation) {
    if (!id || (more && !this.expenseCursor())) return;
    const cursor = more ? `&cursor=${encodeURIComponent(this.expenseCursor()!)}` : '';
    const page = await this.api.request<ExpensePage>(
      `/households/${encodeURIComponent(id)}/transactions?type=expense&status=posted&limit=50${cursor}`,
    );
    if (this.valid(id, g)) {
      this.expenses.set(more ? [...this.expenses(), ...page.transactions] : page.transactions);
      this.expenseCursor.set(page.nextCursor);
    }
  }
  protected async moreExpenses() {
    const id = this.api.selectedId();
    if (!id) return;
    const g = this.generation;
    try {
      await this.loadExpenses(true);
    } catch (e) {
      await this.report(e, id, g);
    }
  }
  protected retry() {
    if (this.retryKind() === 'preview') void this.preview(true);
    else if (this.retryKind() === 'load') void this.initialize();
  }
  protected fileChanged(event: Event) {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.error.set('');
  }
  protected async preview(retry = false) {
    const id = this.api.selectedId();
    if (!id || this.busy()) return;
    const g = this.generation,
      v = this.source.getRawValue();
    if (!retry && v.sourceType === 'sms' && !v.text.trim()) {
      this.error.set('Enter a bank message.');
      return;
    }
    if (
      !retry &&
      v.sourceType !== 'sms' &&
      (!this.file ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(this.file.type) ||
        this.file.size > 1048576)
    ) {
      this.error.set('Choose a JPEG, PNG or WebP image no larger than 1 MiB.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.retryKind.set('');
    this.success.set('');
    try {
      let body: object;
      if (retry && this.lastSource) body = this.lastSource;
      else if (v.sourceType === 'sms') body = { sourceType: 'sms', text: v.text };
      else {
        const file = this.file!;
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Unable to read image'));
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(file);
        });
        if (!this.valid(id, g)) return;
        body = { sourceType: v.sourceType, mimeType: file.type, base64 };
      }
      this.lastSource = body;
      const draft = await this.api.request<Draft>(`${this.base(id)}/preview`, 'POST', body);
      if (!this.valid(id, g)) return;
      this.file = null;
      this.lastSource = null;
      this.source.controls.text.setValue('');
      this.fileInputs().forEach((input) => (input.nativeElement.value = ''));
      this.populate(draft);
      void this.refreshDrafts(id, g).catch(() => {});
    } catch (e) {
      if (this.valid(id, g)) {
        this.retryKind.set('preview');
        await this.report(e, id, g);
      }
    } finally {
      if (this.valid(id, g)) this.busy.set(false);
    }
  }
  private async refreshDrafts(id: string, g: number) {
    const result = await this.api.request<{ drafts: Summary[] }>(this.base(id));
    if (this.valid(id, g)) this.drafts.set(result.drafts);
  }
  protected async open(draftId: string) {
    const id = this.api.selectedId();
    if (!id || this.busy()) return;
    const g = this.generation;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const d = await this.api.request<Draft>(`${this.base(id)}/${encodeURIComponent(draftId)}`);
      if (this.valid(id, g)) this.populate(d);
    } catch (e) {
      if (this.valid(id, g)) await this.report(e, id, g);
    } finally {
      if (this.valid(id, g)) this.busy.set(false);
    }
  }
  private decimal(value: string | null | undefined) {
    if (!value) return '';
    const n = BigInt(value);
    return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
  }
  private itemGroup(i?: Item) {
    return this.fb.nonNullable.group({
      name: i?.name ?? '',
      quantity: i?.quantity ?? '',
      unitPrice: this.decimal(i?.unitPriceMinor),
      amount: this.decimal(i?.amountMinor),
    });
  }
  protected addItem() {
    this.items.push(this.itemGroup());
  }
  protected removeItem(i: number) {
    this.items.removeAt(i);
  }
  private populate(d: Draft) {
    this.current.set(d);
    const x = d.draft;
    this.form.reset({
      type: x.type ?? '',
      date: x.date ?? '',
      accountId: d.suggestedAccountId ?? '',
      fromAccountId: d.suggestedAccountId ?? '',
      toAccountId: '',
      amount: this.decimal(x.debitAmountMinor ?? x.amountMinor),
      debitAmount: this.decimal(x.debitAmountMinor ?? x.amountMinor),
      creditAmount: '',
      categoryId: d.categoryDecision.categoryId ?? '',
      merchant: x.merchant ?? x.recipient ?? '',
      note: '',
      exchangeRate: '',
      exchangeRateSource: '',
      fee: this.decimal(x.feeMinor),
      feeCategoryId: '',
      feeRate: '',
      feeRateSource: '',
      purchaseTransactionId: '',
      existingExpenseId: '',
      settlementConfirmed: false,
      keepSeparate: false,
    });
    this.items.clear();
    for (const item of x.items) this.items.push(this.itemGroup(item));
    requestAnimationFrame(() => document.getElementById('review-heading')?.focus());
  }
  protected flagLabel(flag: string): string {
    const labels: Record<string, string> = {
      REVIEW_REQUIRED: 'Review required',
      DECLINED: 'Transaction declined',
      PENDING_SETTLEMENT: 'Settlement pending',
      STATUS_UNKNOWN: 'Settlement status unknown',
      MISSING_ESSENTIALS: 'Some essential details are missing',
      TRANSFER_DETAILS_REQUIRED: 'Transfer details need review',
      REFUND_LINK_REQUIRED: 'Choose the original purchase',
    };
    return this.i18n.t(labels[flag] ?? 'Review these recognized details carefully.');
  }
  protected eligible(type: string) {
    return this.categories().filter((c) => c.status === 'active' && c.type === type);
  }
  protected account(id: string) {
    return this.active().find((a) => a.id === id);
  }
  protected money(amount: string | null, currency: string | null) {
    return amount && currency ? formatMinor(amount, currency, this.i18n.locale()) : '—';
  }
  protected async confirm(mode: 'post' | 'attach') {
    const id = this.api.selectedId(),
      d = this.current();
    if (!id || !d || this.busy() || d.status !== 'pending' || d.draft.status === 'declined') return;
    const g = this.generation,
      v = this.form.getRawValue();
    const minor = (s: string) => decimalToMinor(s, false, this.i18n.locale());
    const positive = (s: string | null) =>
      s !== null && BigInt(s) > 0n && BigInt(s) <= BigInt(Number.MAX_SAFE_INTEGER);
    const lines = [];
    for (const item of this.items.getRawValue()) {
      const unit = item.unitPrice ? minor(item.unitPrice) : null,
        amount = item.amount ? minor(item.amount) : null;
      if (
        !item.name.trim() ||
        (item.unitPrice && unit === null) ||
        (item.amount && amount === null) ||
        (item.quantity && !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(item.quantity))
      ) {
        this.error.set('Check receipt items and amounts.');
        return;
      }
      lines.push({
        name: item.name.trim(),
        quantity: item.quantity || null,
        unitPriceMinor: unit,
        amountMinor: amount,
      });
    }
    if (d.possibleDuplicates.length && !v.keepSeparate && mode === 'post') {
      this.error.set('Review possible duplicates and confirm you want to keep this separate.');
      return;
    }
    let body: object;
    if (mode === 'attach') {
      if (!v.existingExpenseId) {
        this.error.set('Choose an existing expense.');
        return;
      }
      body = { mode, transactionId: v.existingExpenseId, items: lines };
    } else {
      if (d.draft.status !== 'posted' && !v.settlementConfirmed) {
        this.error.set('Confirm settlement before posting.');
        return;
      }
      if (!v.date) {
        this.error.set('Enter a date.');
        return;
      }
      if (!v.type) {
        this.error.set('Choose a transaction type.');
        return;
      }
      if ((d.draft.type === 'transfer' || d.draft.type === 'refund') && v.type !== d.draft.type) {
        this.error.set('Choose the recognized transaction type.');
        return;
      }
      const common = {
        transactionDate: v.date,
        merchant: v.merchant.trim() || null,
        note: v.note.trim() || null,
      };
      let transaction: object;
      if (v.type === 'transfer') {
        const from = this.account(v.fromAccountId),
          to = this.account(v.toAccountId),
          debit = minor(v.debitAmount),
          credit = minor(v.creditAmount),
          fee = v.fee ? minor(v.fee) : null;
        if (
          !from ||
          !to ||
          from.id === to.id ||
          !positive(debit) ||
          !positive(credit) ||
          (from.currency === to.currency && debit !== credit) ||
          (v.fee &&
            (!positive(fee) ||
              !this.eligible('expense').some((c) => c.id === v.feeCategoryId) ||
              (from.currency !== 'RSD' && (!v.feeRate.trim() || !v.feeRateSource.trim()))))
        ) {
          this.error.set('Check the accounts, amounts, fee and exchange rate.');
          return;
        }
        transaction = {
          type: 'transfer',
          ...common,
          fromAccountId: from.id,
          toAccountId: to.id,
          debitAmountMinor: debit,
          creditAmountMinor: credit,
          debitCurrency: from.currency,
          creditCurrency: to.currency,
          fee: v.fee
            ? {
                amountMinor: fee,
                categoryId: v.feeCategoryId,
                exchangeRate: from.currency === 'RSD' ? null : v.feeRate.trim(),
                exchangeRateSource: from.currency === 'RSD' ? null : v.feeRateSource.trim(),
              }
            : null,
        };
      } else {
        const account = this.account(v.accountId),
          amount = minor(v.amount);
        if (!account || !positive(amount)) {
          this.error.set('Check the account and amount.');
          return;
        }
        if (v.type === 'refund') {
          const purchase = this.expenses().find((x) => x.id === v.purchaseTransactionId);
          if (!purchase || purchase.currency !== account.currency) {
            this.error.set(
              'Choose a posted purchase, a matching active account and a valid amount.',
            );
            return;
          }
          transaction = {
            type: 'refund',
            ...common,
            purchaseTransactionId: purchase.id,
            accountId: account.id,
            amountMinor: amount,
          };
        } else {
          if (
            !this.eligible(v.type).some((c) => c.id === v.categoryId) ||
            (account.currency !== 'RSD' && (!v.exchangeRate.trim() || !v.exchangeRateSource.trim()))
          ) {
            this.error.set('Check the account, category, amount and exchange rate.');
            return;
          }
          transaction = {
            type: v.type,
            ...common,
            accountId: account.id,
            categoryId: v.categoryId,
            amountMinor: amount,
            currency: account.currency,
            exchangeRate: account.currency === 'RSD' ? null : v.exchangeRate.trim(),
            exchangeRateSource: account.currency === 'RSD' ? null : v.exchangeRateSource.trim(),
          };
        }
      }
      body = { mode, transaction, items: lines, settlementConfirmed: v.settlementConfirmed };
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.api.request<{ transactionId: string }>(
        `${this.base(id)}/${encodeURIComponent(d.id)}/confirm`,
        'POST',
        body,
      );
      if (!this.valid(id, g)) return;
      this.current.set({ ...d, status: 'confirmed', transactionId: result.transactionId });
      this.success.set('Import confirmed.');
      void this.workspace.load(id);
      await this.refreshDrafts(id, g);
    } catch (e) {
      if (this.valid(id, g)) await this.report(e, id, g);
    } finally {
      if (this.valid(id, g)) this.busy.set(false);
    }
  }
}
