import { Localization } from '../../core/i18n/localization';
import { Component, inject, input, output } from '@angular/core';

@Component({
  selector: 'app-results-state',
  template: `@if (variant() === 'no-match') {
      <p class="empty">{{ i18n.t('No results match your filters.') }}</p>
      <button class="btn" type="button" (click)="reset.emit()">
        {{ i18n.t('Reset filters') }}
      </button>
    } @else {
      <p class="empty">{{ message() }}</p>
    }`,
})
export class ResultsState {
  protected readonly i18n = inject(Localization);
  readonly variant = input<'empty' | 'no-match'>('empty');
  readonly message = input('No results yet.');
  readonly reset = output<void>();
}
