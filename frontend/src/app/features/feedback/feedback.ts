import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { form, FormField, maxLength, required } from '@angular/forms/signals';
import { Api, ApiError } from '../../core/api';
import { Localization } from '../../core/i18n/localization';
import { containDialogFocus, openCreationDialog } from '../../shared/ui/creation-dialog';

@Component({
  selector: 'app-feedback',
  imports: [FormField],
  templateUrl: './feedback.html',
  styleUrl: './feedback.css',
})
export class Feedback {
  protected readonly i18n = inject(Localization);
  private readonly api = inject(Api);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  protected readonly containFocus = containDialogFocus;
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  protected readonly issue = signal<{ number: number; url: string } | null>(null);
  protected readonly model = signal({ title: '', message: '' });
  protected readonly feedbackForm = form(this.model, (path) => {
    required(path.title);
    maxLength(path.title, 100);
    required(path.message);
    maxLength(path.message, 2000);
  });
  protected open(): void {
    if (this.issue()) {
      this.model.set({ title: '', message: '' });
      this.issue.set(null);
      this.error.set('');
    }
    openCreationDialog(this.dialog()?.nativeElement);
  }
  protected close(): void {
    this.dialog()?.nativeElement.close();
  }
  protected restore(): void {
    const trigger = this.trigger()?.nativeElement;
    if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
    else document.querySelector<HTMLElement>('.profile-menu summary')?.focus();
  }
  protected async send(): Promise<void> {
    if (this.pending()) return;
    const { title: rawTitle, message: rawMessage } = this.model();
    const title = rawTitle.trim(),
      message = rawMessage.trim();
    if (title.length < 5 || title.length > 100 || message.length < 10 || message.length > 2000) {
      this.error.set('Enter a title of 5–100 characters and a message of 10–2000 characters.');
      return;
    }
    this.pending.set(true);
    this.error.set('');
    try {
      const result = await this.api.request<{ issueNumber: number; issueUrl: string }>(
        '/feedback',
        'POST',
        { title, message },
      );
      if (
        !Number.isSafeInteger(result.issueNumber) ||
        result.issueNumber <= 0 ||
        result.issueUrl !== `https://github.com/seregka23/finance-repo/issues/${result.issueNumber}`
      ) {
        this.error.set('Feedback may have been sent. Check GitHub before trying again.');
      } else {
        this.issue.set({ number: result.issueNumber, url: result.issueUrl });
        setTimeout(() =>
          this.dialog()?.nativeElement.querySelector<HTMLElement>('#feedback-issue-link')?.focus(),
        );
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await this.api.handleError(e);
      }
      this.error.set(
        e instanceof ApiError && e.code === 'INVALID_INPUT'
          ? 'Enter a title of 5–100 characters and a message of 10–2000 characters.'
          : e instanceof ApiError && e.code === 'RATE_LIMITED'
            ? 'Too many feedback submissions. Please wait and try again.'
            : e instanceof ApiError && e.code === 'FEEDBACK_UNAVAILABLE'
              ? 'Feedback is temporarily unavailable. Please try again later.'
              : 'Feedback may have been sent. Check GitHub before trying again.',
      );
    } finally {
      this.pending.set(false);
    }
  }
}
