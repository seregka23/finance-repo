import { FormControl, FormGroup, Validators } from '@angular/forms';
import type { AccountInput, Currency } from './account.model';

export function createAccountForm(today: string) {
  return new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    type: new FormControl<AccountInput['type']>('cash', { nonNullable: true }),
    currency: new FormControl<Currency>('RSD', { nonNullable: true }),
    ownerMemberId: new FormControl('', { nonNullable: true }),
    designation: new FormControl<AccountInput['designation']>('personal', { nonNullable: true }),
    bankName: new FormControl('', { nonNullable: true }),
    cardLastFour: new FormControl('', { nonNullable: true }),
    opening: new FormControl('0', { nonNullable: true }),
    date: new FormControl(today, { nonNullable: true }),
  });
}

export function createAdjustmentForm(today: string) {
  return new FormGroup({
    amount: new FormControl('', { nonNullable: true }),
    date: new FormControl(today, { nonNullable: true }),
  });
}
