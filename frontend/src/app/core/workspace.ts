import { effect, inject, Injectable, signal } from '@angular/core';
import { Api } from './api';

export interface WorkspaceData {
  counts: {
    accounts: number;
    transactions: number;
    plans: number;
    reserves: number;
    accountMovements: number;
  };
  capabilities: {
    accounts: boolean;
    transactions: boolean;
    imports: boolean;
    budgets: boolean;
    reserves: boolean;
    reports: boolean;
  };
}
@Injectable({ providedIn: 'root' })
export class Workspace {
  private readonly api = inject(Api);
  readonly data = signal<WorkspaceData | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private generation = 0;
  constructor() {
    effect(() => {
      const id = this.api.selectedId();
      this.generation++;
      this.data.set(null);
      this.error.set('');
      if (id) void this.load(id);
      else this.loading.set(false);
    });
  }
  async load(id = this.api.selectedId()): Promise<void> {
    if (!id) return;
    const generation = ++this.generation;
    this.data.set(null);
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.api.request<WorkspaceData>(
        `/households/${encodeURIComponent(id)}/workspace`,
      );
      if (generation === this.generation && this.api.selectedId() === id) this.data.set(data);
    } catch (error) {
      if (generation === this.generation && this.api.selectedId() === id) {
        const message = await this.api.handleError(error);
        if (generation === this.generation && this.api.selectedId() === id) this.error.set(message);
      }
    } finally {
      if (generation === this.generation && this.api.selectedId() === id) this.loading.set(false);
    }
  }
}
