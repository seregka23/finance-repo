import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
const fragment = new URLSearchParams(window.location.hash.slice(1));
const invitation = fragment.get('invite');
if (invitation) {
  sessionStorage.setItem('family-invite', invitation);
  history.replaceState(history.state, '', window.location.pathname + window.location.search);
}
bootstrapApplication(App, appConfig).catch((err: unknown) => console.error(err));
