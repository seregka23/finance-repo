import { Routes } from '@angular/router';
const finance = () => import('./finance').then((m) => m.Finance);
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  ...['Dashboard', 'Accounts', 'Transactions', 'Budgets', 'Reserves', 'Reports'].map((page) => ({
    path: page.toLowerCase(),
    title: `${page} | Family Finance`,
    data: { page },
    loadComponent: finance,
  })),
  {
    path: 'settings',
    title: 'Household settings | Family Finance',
    loadComponent: () => import('./settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'dashboard' },
];
