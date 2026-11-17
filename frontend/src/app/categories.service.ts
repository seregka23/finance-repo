import { Injectable, inject } from '@angular/core';
import { Api } from './api';

export type CategoryType = 'expense' | 'income';
export type CategoryStatus = 'active' | 'archived';
export type CategoryUsage = 'expense' | 'income' | 'fee' | 'refund' | 'budget' | 'transfer';
export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
}
@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly api = inject(Api);
  private base(id: string): string {
    return `/households/${encodeURIComponent(id)}/categories`;
  }
  list(id: string): Promise<{ categories: Category[] }> {
    return this.api.request(`${this.base(id)}?status=all`);
  }
  listEligible(
    id: string,
    usage: CategoryUsage,
  ): Promise<{ usage: CategoryUsage; categories: Category[] }> {
    return this.api.request(`${this.base(id)}/options?usage=${encodeURIComponent(usage)}`);
  }
  referenceNames(id: string): Promise<{ expense: string[]; income: string[] }> {
    return this.api.request(`${this.base(id)}/reference-names`);
  }
  create(id: string, name: string, type: CategoryType): Promise<Category> {
    return this.api.request(this.base(id), 'POST', { name, type });
  }
  update(
    id: string,
    categoryId: string,
    change: { name?: string; status?: CategoryStatus },
  ): Promise<Category> {
    return this.api.request(`${this.base(id)}/${encodeURIComponent(categoryId)}`, 'PATCH', change);
  }
}
