import { formatMinor } from '../../shared/formatters/formatters';
import { Localization } from '../../core/i18n/localization';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Workspace } from '../../core/workspace';
import { ResultsState } from '../../shared/ui/results-state';

@Component({ imports: [RouterLink, ResultsState], templateUrl: './finance.html' })
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
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('chooser');
  private opener: HTMLElement | null = null;
  constructor() {
    effect(() => {
      this.api.selectedId();
      this.close();
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
