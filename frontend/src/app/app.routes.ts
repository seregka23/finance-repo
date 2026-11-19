import { Routes } from '@angular/router';
const finance = () => import('./features/finance/finance').then((m) => m.Finance);
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  ...['Dashboard', 'Budgets', 'Reports'].map((page) => ({
    path: page.toLowerCase(),
    data: { page },
    loadComponent: finance,
  })),
  {
    path: 'reserves',
    loadComponent: () => import('./features/reserves/reserves').then((m) => m.Reserves),
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
