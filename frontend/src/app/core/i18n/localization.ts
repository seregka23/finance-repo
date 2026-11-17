import { Injectable, signal } from '@angular/core';
import { ru } from './ru-catalog';
import { sr } from './sr-catalog';

export type Language = 'en' | 'ru' | 'sr';
@Injectable({ providedIn: 'root' })
export class Localization {
  readonly language = signal<Language>(this.initial());
  readonly locale = () => ({ en: 'en-US', ru: 'ru-RU', sr: 'sr-Latn-RS' })[this.language()];
  private initial(): Language {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('family-finance-language');
    } catch {
      /* Storage can be blocked. */
    }
    if (saved === 'en' || saved === 'ru' || saved === 'sr') return saved;
    const browser = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase();
    return browser.startsWith('ru') ? 'ru' : browser.startsWith('sr') ? 'sr' : 'en';
  }
  set(language: Language): void {
    if (!['en', 'ru', 'sr'].includes(language)) return;
    this.language.set(language);
    try {
      localStorage.setItem('family-finance-language', language);
    } catch {
      /* Preference is optional. */
    }
  }
  t(message: string, params: Record<string, string | number> = {}): string {
    const language = this.language();
    const catalog: Record<string, string> =
      language === 'ru'
        ? ru
        : language === 'sr'
          ? sr
          : { 'Create financial account': 'Create account' };
    return (catalog[message] ?? message).replace(/\{(\w+)\}/g, (match, key: string) =>
      String(params[key] ?? match),
    );
  }
}
