import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./settings').then((m) => m.Settings) },
  { path: '**', redirectTo: '' },
];
