import { Localization } from './localization';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from './api';
import { CategoriesService, Category, CategoryStatus, CategoryType } from './categories.service';
import { ResultsState } from './results-state';

@Component({
  imports: [ReactiveFormsModule, RouterLink, ResultsState],
  templateUrl: './categories.html',
  styleUrl: './categories.css',
})
export class Categories {
  protected readonly i18n = inject(Localization);
  protected readonly api = inject(Api);
  private readonly service = inject(CategoriesService);
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');
  private readonly renameButtons = viewChildren<ElementRef<HTMLButtonElement>>('renameButton');
  protected readonly rows = signal<Category[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal('');
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly status = signal<'all' | CategoryStatus>('all');
  protected readonly suggestions = signal<{ expense: string[]; income: string[] }>({
    expense: [],
    income: [],
  });
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(80)],
    }),
    type: new FormControl<CategoryType>('expense', { nonNullable: true }),
  });
  protected readonly editName = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(80)],
  });
  protected readonly editForm = new FormGroup({ name: this.editName });
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    return this.rows().filter(
      (row) =>
        (this.status() === 'all' || row.status === this.status()) &&
        row.name.toLocaleLowerCase().includes(q),
    );
  });
  private generation = 0;
  constructor() {
    effect((onCleanup) => {
      const id = this.api.selectedId();
      const generation = ++this.generation;
      onCleanup(() => {
        this.generation++;
      });
      this.rows.set([]);
      this.loading.set(false);
      this.loadError.set('');
      this.error.set('');
      this.success.set('');
      this.busy.set(false);
      this.editing.set(null);
      this.resetFilters();
      this.form.reset({ name: '', type: 'expense' });
      this.suggestions.set({ expense: [], income: [] });
      if (id) {
        void this.load(id, generation);
        void this.loadSuggestions(id, generation);
      }
    });
  }
  private current(id: string, generation: number): boolean {
    return this.api.selectedId() === id && this.generation === generation;
  }
  protected async retry(): Promise<void> {
    const id = this.api.selectedId();
    if (id) await this.load(id, this.generation);
  }
  private async load(id: string, generation: number): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const data = await this.service.list(id);
      if (this.current(id, generation)) this.rows.set(data.categories);
    } catch (e) {
      if (this.current(id, generation)) {
        const message = await this.api.handleError(e);
        if (this.current(id, generation)) this.loadError.set(message);
      }
    } finally {
      if (this.current(id, generation)) this.loading.set(false);
    }
  }
  private async loadSuggestions(id: string, generation: number): Promise<void> {
    try {
      const data = await this.service.referenceNames(id);
      if (this.current(id, generation)) this.suggestions.set(data);
    } catch {
      /* Suggestions are optional. */
    }
  }
  protected resetFilters(): void {
    this.query.set('');
    this.status.set('all');
  }
  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
  protected setStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as 'all' | CategoryStatus);
  }
  protected suggest(name: string, type: CategoryType): void {
    this.form.setValue({ name, type });
  }
  protected startEdit(row: Category): void {
    this.editing.set(row.id);
    this.editName.setValue(row.name);
    this.error.set('');
    this.success.set('');
    setTimeout(() => this.editInput()?.nativeElement.focus());
  }
  protected cancelEdit(id: string): void {
    this.editing.set(null);
    this.focusRename(id);
  }
  private focusRename(id: string): void {
    setTimeout(() =>
      this.renameButtons()
        .find((button) => button.nativeElement.dataset['categoryId'] === id)
        ?.nativeElement.focus(),
    );
  }
  protected async create(): Promise<void> {
    const name = this.form.controls.name.value.trim();
    if (!name || name.length > 80) {
      this.error.set('Enter a category name of 1 to 80 characters.');
      this.form.controls.name.markAsTouched();
      return;
    }
    const type = this.form.controls.type.value;
    await this.run(async (id) => {
      const row = await this.service.create(id, name, type);
      return () => {
        this.rows.update((rows) => [...rows, row]);
        this.form.controls.name.reset();
        this.success.set('Category created.');
      };
    });
  }
  protected async rename(row: Category): Promise<void> {
    const name = this.editName.value.trim();
    if (!name || name.length > 80) {
      this.error.set('Enter a category name of 1 to 80 characters.');
      return;
    }
    await this.run(async (id) => {
      const saved = await this.service.update(id, row.id, { name });
      return () => {
        this.replace(saved);
        this.editing.set(null);
        this.success.set('Category renamed.');
        this.focusRename(saved.id);
      };
    });
  }
  protected async toggle(row: Category): Promise<void> {
    const status = row.status === 'active' ? 'archived' : 'active';
    await this.run(async (id) => {
      const saved = await this.service.update(id, row.id, { status });
      return () => {
        this.replace(saved);
        this.editing.set(null);
        this.success.set(status === 'active' ? 'Category restored.' : 'Category archived.');
      };
    });
  }
  private replace(saved: Category): void {
    this.rows.update((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
  }
  private async run(action: (id: string) => Promise<() => void>): Promise<void> {
    const id = this.api.selectedId();
    if (!id || this.busy()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const apply = await action(id);
      if (this.current(id, generation)) apply();
    } catch (e) {
      if (this.current(id, generation)) {
        const message = await this.api.handleError(e);
        if (this.current(id, generation)) this.error.set(message);
      }
    } finally {
      if (this.current(id, generation)) this.busy.set(false);
    }
  }
}
