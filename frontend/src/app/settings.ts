import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Api, Household, Members } from './api';
@Component({ imports: [ReactiveFormsModule, DatePipe], templateUrl: './settings.html' })
export class Settings {
  protected readonly api = inject(Api);
  protected readonly household = computed(
    () => this.api.session()?.households.find((h) => h.id === this.api.selectedId()) ?? null,
  );
  protected readonly members = signal<Members | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly inviteLink = signal('');
  protected readonly confirmMember = signal<string | null>(null);
  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    timeZone: new FormControl('', { nonNullable: true }),
  });
  protected readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });
  protected readonly invitationForm = new FormGroup({ email: this.email });
  constructor() {
    effect(() => {
      const h = this.household();
      this.form.setValue({ name: h?.name ?? '', timeZone: h?.timeZone ?? '' });
      this.members.set(null);
      this.inviteLink.set('');
      this.confirmMember.set(null);
      if (h) void this.loadMembers(h.id);
    });
  }
  protected async loadMembers(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const m = await this.api.request<Members>(`/households/${encodeURIComponent(id)}/members`);
      if (this.api.selectedId() === id) this.members.set(m);
    } catch (e) {
      this.error.set(await this.api.handleError(e));
    } finally {
      this.loading.set(false);
    }
  }
  protected select(event: Event): void {
    this.api.selectedId.set((event.target as HTMLSelectElement).value);
  }
  protected async save(): Promise<void> {
    if (this.form.invalid || !this.form.value.name?.trim()) {
      this.form.markAllAsTouched();
      this.error.set('Enter a household name.');
      return;
    }
    const h = this.household();
    const body = {
      name: this.form.controls.name.value.trim(),
      ...(this.form.controls.timeZone.value.trim()
        ? { timeZone: this.form.controls.timeZone.value.trim() }
        : {}),
    };
    await this.run(async () => {
      const saved = await this.api.request<Household>(
        h ? `/households/${encodeURIComponent(h.id)}` : '/households',
        h ? 'PATCH' : 'POST',
        body,
      );
      await this.api.refreshSession(saved.id);
      this.success.set(h ? 'Household settings saved.' : 'Household created.');
    });
  }
  protected async invite(): Promise<void> {
    if (this.email.invalid || !this.household()) {
      this.email.markAsTouched();
      this.error.set('Enter a valid email address.');
      return;
    }
    const id = this.household()!.id;
    await this.run(async () => {
      const inv = await this.api.request<{ token: string }>(
        `/households/${encodeURIComponent(id)}/invitations`,
        'POST',
        { email: this.email.value.trim() },
      );
      this.inviteLink.set(`${location.origin}/#invite=${encodeURIComponent(inv.token)}`);
      this.email.reset();
      await this.loadMembers(id);
      this.success.set('Invitation created. Copy the link below; it will only be shown once.');
    });
  }
  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLink());
      this.success.set('Invitation link copied.');
    } catch {
      this.error.set('Could not copy automatically. Select and copy the link below.');
    }
  }
  protected async remove(kind: 'members' | 'invitations', id: string): Promise<void> {
    const h = this.household();
    if (!h) return;
    await this.run(async () => {
      await this.api.request<void>(
        `/households/${encodeURIComponent(h.id)}/${kind}/${encodeURIComponent(id)}`,
        'DELETE',
      );
      this.confirmMember.set(null);
      await this.loadMembers(h.id);
      this.success.set(kind === 'members' ? 'Member access revoked.' : 'Invitation cancelled.');
    });
  }
  protected async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      await action();
    } catch (e) {
      this.error.set(await this.api.handleError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
