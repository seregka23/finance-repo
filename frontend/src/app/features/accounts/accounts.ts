import { createAccountForm, createAdjustmentForm } from './account-forms';
import { Localization } from '../../core/i18n/localization';
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
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { containDialogFocus, openCreationDialog } from '../../shared/ui/creation-dialog';
import { Api, Members } from '../../core/api';
import { AccountsService } from './accounts.service';
import type { Account, AccountInput, Movement } from './account.model';
import {
  decimalToMinor,
  formatMinor,
  formatCalendarDate,
} from '../../shared/formatters/formatters';
import { Workspace } from '../../core/workspace';

@Component({
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './accounts.html',
  styleUrl: './accounts.css',
})
export class Accounts {
  protected readonly i18n = inject(Localization);
  protected readonly api = inject(Api);
  private readonly service = inject(AccountsService);
  private readonly workspace = inject(Workspace);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('creationDialog');
  protected readonly creating = signal(false);
  protected readonly containFocus = containDialogFocus;
  private opener: HTMLElement | null = null;
  private operation = 0;
  private pendingCreate = this.route.snapshot.queryParamMap.has('create');
  protected readonly rows = signal<Account[]>([]);
  protected readonly members = signal<Members['members']>([]);
  protected readonly selected = signal<Account | null>(null);
  protected readonly movements = signal<Movement[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly status = signal<'all' | 'active' | 'archived'>('all');
  protected readonly filtered = computed(() =>
    this.rows().filter((a) => this.status() === 'all' || a.status === this.status()),
  );
  protected readonly loading = signal(false);
  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal('');
  protected readonly loadError = signal('');
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly busy = signal(false);
  protected readonly editing = signal(false);
  protected readonly adjustmentReview = signal(false);
  protected readonly format = (value: string, currency: string) =>
    formatMinor(value, currency, this.i18n.locale());
  protected dateOnly(value: string): string {
    return formatCalendarDate(value, this.i18n.locale());
  }
  protected readonly form = createAccountForm(this.today());
  protected readonly adjustment = createAdjustmentForm(this.today());
  private today(): string {
    const h = this.api.session()?.households.find((h) => h.id === this.api.selectedId());
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: h?.timeZone ?? 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    return ['year', 'month', 'day']
      .map((type) => parts.find((p) => p.type === type)!.value)
      .join('-');
  }
  private generation = 0;
  private detailGeneration = 0;
  constructor() {
    effect((onCleanup) => {
      const id = this.api.selectedId();
      const generation = ++this.generation;
      onCleanup(() => {
        this.generation++;
        this.detailGeneration++;
      });
      untracked(() => this.cancelCreate(undefined, true));
      this.rows.set([]);
      this.members.set([]);
      this.selected.set(null);
      this.movements.set([]);
      this.loading.set(false);
      this.historyLoading.set(false);
      this.loadError.set('');
      this.error.set('');
      this.success.set('');
      this.busy.set(false);
      this.editing.set(false);
      this.adjustmentReview.set(false);
      this.adjustment.reset({ amount: '', date: this.today() });
      this.status.set('all');
      this.resetForm();
      if (id) void this.load(id, generation);
    });
  }
  private current(id: string, g: number): boolean {
    return this.api.selectedId() === id && this.generation === g;
  }
  protected async retry(): Promise<void> {
    const id = this.api.selectedId();
    if (id) await this.load(id, this.generation);
  }
  private async load(id: string, g: number): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const [rows, members] = await Promise.all([this.service.list(id), this.service.members(id)]);
      if (this.current(id, g)) {
        this.rows.set(rows.accounts);
        this.members.set(members.members);
        if (this.pendingCreate) {
          this.pendingCreate = false;
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { create: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
          this.create();
        }
      }
    } catch (e) {
      if (this.current(id, g)) {
        const message = await this.api.handleError(e);
        if (this.current(id, g)) this.loadError.set(message);
      }
    } finally {
      if (this.current(id, g)) this.loading.set(false);
    }
  }
  protected inactiveOwner(id: string | null): boolean {
    return !!id && !this.members().some((m) => m.id === id && m.status === 'active');
  }
  protected owner(id: string | null): string {
    return id
      ? (this.members().find((m) => m.id === id)?.email ?? this.i18n.t('Former member'))
      : this.i18n.t('Household');
  }
  protected setStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as 'all' | 'active' | 'archived');
  }
  protected closeDetails(): void {
    this.detailGeneration++;
    this.selected.set(null);
    this.historyLoading.set(false);
    this.resetForm();
  }
  protected async open(row: Account): Promise<void> {
    if (this.busy()) return;
    const id = this.api.selectedId();
    if (!id) return;
    const g = this.generation;
    const d = ++this.detailGeneration;
    this.selected.set(row);
    this.adjustmentReview.set(false);
    this.editing.set(false);
    this.form.controls.currency.enable({ emitEvent: false });
    this.movements.set([]);
    this.cursor.set(null);
    this.historyError.set('');
    this.historyLoading.set(true);
    try {
      const [account, page] = await Promise.all([
        this.service.get(id, row.id),
        this.service.movements(id, row.id),
      ]);
      if (this.current(id, g) && d === this.detailGeneration) {
        this.selected.set(account);
        this.replace(account);
        this.movements.set(page.movements);
        this.cursor.set(page.nextCursor);
      }
    } catch (e) {
      if (this.current(id, g) && d === this.detailGeneration) {
        const m = await this.api.handleError(e);
        if (this.current(id, g) && d === this.detailGeneration) this.historyError.set(m);
      }
    } finally {
      if (this.current(id, g) && d === this.detailGeneration) this.historyLoading.set(false);
    }
  }
  protected async more(): Promise<void> {
    const id = this.api.selectedId(),
      row = this.selected(),
      cursor = this.cursor();
    if (!id || !row || !cursor || this.historyLoading()) return;
    const g = this.generation,
      d = this.detailGeneration;
    this.historyLoading.set(true);
    this.historyError.set('');
    try {
      const page = await this.service.movements(id, row.id, cursor);
      if (this.current(id, g) && d === this.detailGeneration) {
        this.movements.update((v) => [...v, ...page.movements]);
        this.cursor.set(page.nextCursor);
      }
    } catch (e) {
      if (this.current(id, g) && d === this.detailGeneration) {
        const m = await this.api.handleError(e);
        if (this.current(id, g) && d === this.detailGeneration) this.historyError.set(m);
      }
    } finally {
      if (this.current(id, g) && d === this.detailGeneration) this.historyLoading.set(false);
    }
  }
  protected create(event?: Event): void {
    if (this.busy() || this.editing() || this.creating()) return;
    this.opener = (event?.currentTarget as HTMLElement | null) ?? null;
    this.error.set('');
    this.resetForm();
    this.creating.set(true);
    openCreationDialog(this.dialog()?.nativeElement);
  }
  protected cancelCreate(event?: Event, force = false): void {
    event?.preventDefault();
    if (this.busy() && !force) return;
    if (!this.creating()) return;
    this.operation++;
    this.busy.set(false);
    this.creating.set(false);
    this.dialog()?.nativeElement.close();
    this.error.set('');
    const opener = this.opener;
    this.opener = null;
    requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLElement>(
        '.pagehead button:not(:disabled), .pagehead h1',
      );
      (opener?.isConnected ? opener : fallback)?.focus();
    });
  }
  protected beginEdit(row: Account): void {
    if (this.busy() || this.historyLoading()) return;
    this.editing.set(true);
    if (row.currencyLocked) this.form.controls.currency.disable({ emitEvent: false });
    else this.form.controls.currency.enable({ emitEvent: false });
    this.error.set('');
    this.form.patchValue({
      name: row.name,
      type: row.type,
      currency: row.currency,
      ownerMemberId: row.ownerMemberId ?? '',
      designation: row.designation,
    });
  }
  protected resetForm(): void {
    this.editing.set(false);
    this.form.controls.currency.enable({ emitEvent: false });
    this.form.reset({
      name: '',
      type: 'cash',
      currency: 'RSD',
      ownerMemberId: '',
      designation: 'personal',
      opening: '0',
      date: this.today(),
    });
  }
  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const opening = decimalToMinor(v.opening, false, this.i18n.locale());
    const row = this.editing() ? this.selected() : null;
    if (!v.name.trim() || v.name.trim().length > 100 || (!row && (opening === null || !v.date))) {
      this.error.set(
        'Enter a name, a valid opening amount with at most two decimal places, and an opening date.',
      );
      return;
    }
    if (v.ownerMemberId && this.inactiveOwner(v.ownerMemberId)) {
      this.error.set('Choose an active owner or Household.');
      return;
    }
    const input: AccountInput = {
      name: v.name.trim(),
      type: v.type,
      currency: row?.currencyLocked ? row.currency : v.currency,
      ownerMemberId: v.ownerMemberId || null,
      designation: v.designation,
    };
    await this.run(
      async (id) =>
        row
          ? this.service.update(id, row.id, { ...input, version: row.version })
          : this.service.create(id, {
              ...input,
              openingBalanceMinor: opening!,
              openingDate: v.date,
            }),
      (saved) => {
        this.replace(saved);
        if (!row) this.cancelCreate(undefined, true);
        this.resetForm();
        this.selected.set(saved);
        this.success.set(row ? 'Account updated.' : 'Account created.');
        void this.open(saved);
      },
    );
  }
  protected async toggle(row: Account): Promise<void> {
    if (this.historyLoading()) return;
    await this.run(
      (id) => this.service.toggle(id, row),
      (saved) => {
        this.replace(saved);
        this.selected.set(saved);
        this.resetForm();
        this.success.set(
          saved.status === 'active'
            ? 'Account restored.'
            : 'Account archived. Its history and balances are preserved.',
        );
      },
    );
  }
  protected async adjust(row: Account): Promise<void> {
    if (this.historyLoading()) return;
    const { amount, date } = this.adjustment.getRawValue();
    const minor = decimalToMinor(amount, true, this.i18n.locale());
    if (minor === null || minor === '0' || !date) {
      this.error.set('Enter a nonzero signed change with at most two decimal places and a date.');
      return;
    }
    if (!this.adjustmentReview()) {
      this.adjustmentReview.set(true);
      return;
    }
    await this.run(
      (id) => this.service.adjust(id, row, minor, date),
      (saved) => {
        this.replace(saved);
        this.selected.set(saved);
        this.adjustment.controls.amount.reset();
        this.adjustmentReview.set(false);
        this.success.set('Balance change recorded.');
        void this.open(saved);
      },
    );
  }
  private replace(saved: Account): void {
    this.rows.update((rows) =>
      rows.some((a) => a.id === saved.id)
        ? rows.map((a) => (a.id === saved.id ? saved : a))
        : [...rows, saved],
    );
  }
  private async run(
    action: (id: string) => Promise<Account>,
    apply: (a: Account) => void,
  ): Promise<void> {
    const id = this.api.selectedId();
    if (!id || this.busy()) return;
    const g = this.generation;
    const operation = this.operation;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const saved = await action(id);
      if (this.current(id, g) && operation === this.operation) {
        this.busy.set(false);
        apply(saved);
        void this.workspace.load(id);
      }
    } catch (e) {
      if (this.current(id, g) && operation === this.operation) {
        const m = await this.api.handleError(e);
        if (this.current(id, g) && operation === this.operation) this.error.set(m);
      }
    } finally {
      if (this.current(id, g) && operation === this.operation) this.busy.set(false);
    }
  }
}
