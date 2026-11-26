import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Api, ApiError } from '../../core/api';
import { Feedback } from './feedback';

describe('feedback', () => {
  afterEach(() => vi.restoreAllMocks());
  it('sends only trimmed text once and displays the verified issue link', async () => {
    const api = TestBed.inject(Api);
    let resolve!: (value: { issueNumber: number; issueUrl: string }) => void;
    const request = vi.spyOn(api, 'request').mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const fixture = TestBed.createComponent(Feedback);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const title = el.querySelector<HTMLInputElement>('#feedback-title')!;
    const message = el.querySelector<HTMLTextAreaElement>('#feedback-message')!;
    title.value = '  A useful title  ';
    title.dispatchEvent(new Event('input'));
    message.value = '  A useful message  ';
    message.dispatchEvent(new Event('input'));
    const form = el.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/feedback', 'POST', {
      title: 'A useful title',
      message: 'A useful message',
    });
    resolve({ issueNumber: 42, issueUrl: 'https://github.com/seregka23/finance-repo/issues/42' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/seregka23/finance-repo/issues/42',
    );
    expect(el.textContent).toContain('View issue #42');
  });
  it('preserves typed values and explains uncertain delivery', async () => {
    const api = TestBed.inject(Api);
    vi.spyOn(api, 'request').mockRejectedValue(new ApiError('FEEDBACK_FAILED', 'failure', 502));
    const fixture = TestBed.createComponent(Feedback);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const title = el.querySelector<HTMLInputElement>('#feedback-title')!;
    const message = el.querySelector<HTMLTextAreaElement>('#feedback-message')!;
    title.value = 'Useful title';
    title.dispatchEvent(new Event('input'));
    message.value = 'Useful feedback message';
    message.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Check GitHub');
    expect(title.value).toBe('Useful title');
    expect(message.value).toBe('Useful feedback message');
  });
});
