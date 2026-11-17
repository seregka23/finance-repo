import { Routes } from '@angular/router';
const finance = () => import('./finance').then((m) => m.Finance);
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  ...['Dashboard', 'Transactions', 'Budgets', 'Reserves', 'Reports'].map((page) => ({
    path: page.toLowerCase(),
    data: { page },
    loadComponent: finance,
  })),
  { path: 'accounts', loadComponent: () => import('./accounts').then((m) => m.Accounts) },
  { path: 'categories', loadComponent: () => import('./categories').then((m) => m.Categories) },
  {
    path: 'settings',
    loadComponent: () => import('./settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'dashboard' },
];
