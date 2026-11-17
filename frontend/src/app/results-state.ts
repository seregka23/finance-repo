import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-results-state',
  template: `@if (variant() === 'no-match') {
      <p class="empty">No results match your filters.</p>
      <button class="btn" type="button" (click)="reset.emit()">Reset filters</button>
    } @else {
      <p class="empty">{{ message() }}</p>
    }`,
})
export class ResultsState {
  readonly variant = input<'empty' | 'no-match'>('empty');
  readonly message = input('No results yet.');
  readonly reset = output<void>();
}
