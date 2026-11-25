import { Routes } from '@angular/router';
const finance = () => import('./features/finance/finance').then((m) => m.Finance);
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  ...['Dashboard', 'Reports'].map((page) => ({
    path: page.toLowerCase(),
    data: { page },
    loadComponent: finance,
  })),
  {
    path: 'budgets',
    loadComponent: () => import('./features/budgets/budgets').then((m) => m.Budgets),
  },
  {
    path: 'reserves',
    loadComponent: () => import('./features/reserves/reserves').then((m) => m.Reserves),
  },
  {
    path: 'transactions/import',
    loadComponent: () =>
      import('./features/import-review/import-review').then((m) => m.ImportReview),
  },
  {
    path: 'transactions',
    loadComponent: () => import('./features/transactions/transactions').then((m) => m.Transactions),
  },
  {
    path: 'accounts',
    loadComponent: () => import('./features/accounts/accounts').then((m) => m.Accounts),
  },
  {
    path: 'categories',
    loadComponent: () => import('./features/categories/categories').then((m) => m.Categories),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'dashboard' },
];
