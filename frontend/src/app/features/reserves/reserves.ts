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
import { Api } from '../../core/api';
import { Localization } from '../../core/i18n/localization';
import { Workspace } from '../../core/workspace';
import { Account } from '../accounts/account.model';
import { AccountsService } from '../accounts/accounts.service';
import { Reserve, ReserveMovement, ReservesService } from './reserves.service';
import { decimalToMinor, formatMinor } from '../../shared/formatters/formatters';
import { containDialogFocus, openCreationDialog } from '../../shared/ui/creation-dialog';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reserves.html',
  styleUrl: './reserves.css',
})
export class Reserves {
  protected api = inject(Api);
  protected i18n = inject(Localization);
  private service = inject(ReservesService);
  private accountsService = inject(AccountsService);
  private workspace = inject(Workspace);
  private fb = inject(FormBuilder);
  private dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  protected containFocus = containDialogFocus;
  protected rows = signal<Reserve[]>([]);
  protected accounts = signal<Account[]>([]);
  protected active = computed(() => this.accounts().filter((a) => a.status === 'active'));
  protected selected = signal<Reserve | null>(null);
  protected movements = signal<ReserveMovement[]>([]);
  protected cursor = signal<string | null>(null);
  protected loading = signal(false);
  protected historyLoading = signal(false);
  protected busy = signal(false);
  protected loadError = signal('');
  protected historyError = signal('');
  protected error = signal('');
  protected success = signal('');
  protected mode = signal<'create' | 'allocation' | 'release' | null>(null);
  protected form = this.fb.nonNullable.group({ name: '', accountId: '', amount: '' });
  private generation = 0;
  private detailGeneration = 0;
  private opener: HTMLElement | null = null;
  constructor() {
    effect((onCleanup) => {
      const id = this.api.selectedId(),
        g = ++this.generation;
      onCleanup(() => {
        this.generation++;
        this.detailGeneration++;
      });
      untracked(() => this.close(undefined, true));
      this.rows.set([]);
      this.accounts.set([]);
      this.selected.set(null);
      this.movements.set([]);
      this.cursor.set(null);
      this.error.set('');
      this.success.set('');
      this.loadError.set('');
      this.historyError.set('');
      this.busy.set(false);
      this.loading.set(false);
      this.historyLoading.set(false);
      if (id) void this.load(id, g);
    });
  }
  private current(id: string, g: number) {
    return this.api.selectedId() === id && this.generation === g;
  }
  private baseError(e: unknown, target: { set(v: string): void }, id: string, g: number) {
    void this.api.handleError(e).then((m) => {
      if (this.current(id, g)) target.set(m);
    });
  }
  protected retry() {
    const id = this.api.selectedId();
    if (id) void this.load(id, this.generation);
  }
  private async load(id: string, g: number) {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const [r, a] = await Promise.all([this.service.list(id), this.accountsService.list(id)]);
      if (this.current(id, g)) {
        this.rows.set(r.reserves);
        this.accounts.set(a.accounts);
      }
    } catch (e) {
      this.baseError(e, this.loadError, id, g);
    } finally {
      if (this.current(id, g)) this.loading.set(false);
    }
  }
  protected account(id: string) {
    return this.accounts().find((a) => a.id === id);
  }
  protected money(v: string, c: string) {
    return formatMinor(v, c, this.i18n.locale());
  }
  protected async open(row: Reserve) {
    const id = this.api.selectedId();
    if (!id || this.busy()) return;
    const g = this.generation,
      d = ++this.detailGeneration;
    this.selected.set(row);
    this.movements.set([]);
    this.cursor.set(null);
    this.historyError.set('');
    this.historyLoading.set(true);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.detail h2')?.focus());
    try {
      const [r, p] = await Promise.all([
        this.service.get(id, row.id),
        this.service.movements(id, row.id),
      ]);
      if (this.current(id, g) && d === this.detailGeneration) {
        this.selected.set(r);
        this.movements.set(p.movements);
        this.cursor.set(p.nextCursor);
      }
    } catch (e) {
      if (d === this.detailGeneration) this.baseError(e, this.historyError, id, g);
    } finally {
      if (this.current(id, g) && d === this.detailGeneration) this.historyLoading.set(false);
    }
  }
  protected async more() {
    const id = this.api.selectedId(),
      row = this.selected(),
      cursor = this.cursor();
    if (!id || !row || !cursor || this.historyLoading()) return;
    const g = this.generation,
      d = this.detailGeneration;
    this.historyLoading.set(true);
    this.historyError.set('');
    try {
      const p = await this.service.movements(id, row.id, cursor);
      if (this.current(id, g) && d === this.detailGeneration) {
        this.movements.update((m) => [...m, ...p.movements]);
        this.cursor.set(p.nextCursor);
      }
    } catch (e) {
      if (d === this.detailGeneration) this.baseError(e, this.historyError, id, g);
    } finally {
      if (this.current(id, g) && d === this.detailGeneration) this.historyLoading.set(false);
    }
  }
  protected start(mode: 'create' | 'allocation' | 'release', event: Event) {
    if (this.busy() || (mode === 'create' && !this.active().length)) return;
    this.opener = event.currentTarget as HTMLElement;
    this.error.set('');
    this.form.reset({ name: '', accountId: this.active()[0]?.id ?? '', amount: '' });
    this.mode.set(mode);
    openCreationDialog(this.dialog()?.nativeElement);
  }
  protected close(event?: Event, force = false) {
    event?.preventDefault();
    if (this.busy() && !force) return;
    if (!this.mode()) return;
    this.mode.set(null);
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
      mode = this.mode(),
      row = this.selected();
    if (!id || !mode || this.busy()) return;
    const v = this.form.getRawValue();
    let minor: string | null = null;
    if (mode === 'create') {
      if (!v.name.trim() || !this.active().some((a) => a.id === v.accountId)) {
        this.error.set('Enter a name and choose an active account.');
        return;
      }
    } else {
      minor = decimalToMinor(v.amount, false, this.i18n.locale());
      if (
        !row ||
        !minor ||
        BigInt(minor) <= 0n ||
        BigInt(minor) > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        this.error.set('Enter a valid amount.');
        return;
      }
    }
    const g = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const saved =
        mode === 'create'
          ? await this.service.create(id, v.accountId, v.name.trim())
          : (await this.service.move(id, row!.id, mode, minor!)).reserve;
      if (!this.current(id, g)) return;
      this.busy.set(false);
      this.close();
      this.success.set(mode === 'create' ? 'Reserve created.' : 'Reserve updated.');
      await this.load(id, g);
      if (this.current(id, g)) {
        void this.workspace.load(id);
        await this.open(saved);
      }
    } catch (e) {
      this.baseError(e, this.error, id, g);
    } finally {
      if (this.current(id, g)) this.busy.set(false);
    }
  }
}
