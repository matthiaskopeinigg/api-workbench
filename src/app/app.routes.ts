import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/workspace/home.component').then((m) => m.HomeComponent),
  },
  { path: '**', redirectTo: '' },
];
