import { describe, expect, it, vi } from 'vitest';
import { AccountsService } from './accounts.service.js';
import type { AccountsRepository } from './accounts.repository.js';
const identity = { subject: 'user:fixture', email: 'fixture@example.invalid' };
const metadata = {
  name: 'Account',
  type: 'bank',
  currency: 'RSD',
  ownerMemberId: null,
  designation: 'personal',
};
const creation = {
  ...metadata,
  openingBalanceMinor: '0',
  openingDate: '2024-02-29',
};
function setup() {
  const repository = {
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    adjust: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    movements: vi.fn(),
  };
  return {
    service: new AccountsService(repository as unknown as AccountsRepository),
    repository,
  };
}
describe('account input contracts', () => {
  it('accepts zero opening balances and normalizes display metadata', () => {
    const { service, repository } = setup();
    void service.create(identity, 'house', {
      ...creation,
      name: '  Savings  ',
      ownerMemberId: ' member ',
    });
    expect(repository.create).toHaveBeenCalledWith(
      identity,
      'house',
      { ...metadata, name: 'Savings', ownerMemberId: 'member' },
      '0',
      '2024-02-29',
    );
  });
  it.each([
    { openingBalanceMinor: '-1' },
    { openingBalanceMinor: '01' },
    { openingBalanceMinor: 12 },
    { openingBalanceMinor: '9007199254740992' },
    { openingDate: '2026-02-29' },
    { type: ['cash'] },
    { designation: ['personal'] },
    { currency: 'GBP' },
    { ownerMemberId: '' },
    { ownerMemberId: false },
    { name: ' ' },
    { name: 'a'.repeat(101) },
    { unexpected: true },
    { balanceMinor: '100' },
  ])('rejects invalid creation fields %j before persistence', (extra) => {
    const { service, repository } = setup();
    expect(() =>
      service.create(identity, 'house', { ...creation, ...extra }),
    ).toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('requires every metadata field for a replacement and blocks opening balance rewrites', () => {
    const { service, repository } = setup();
    expect(() =>
      service.update(identity, 'house', 'account', { name: 'New', version: 1 }),
    ).toThrow();
    expect(() =>
      service.update(identity, 'house', 'account', {
        ...metadata,
        version: 1,
        openingBalanceMinor: '1',
      }),
    ).toThrow();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, '1', 9007199254740992, null])(
    'rejects unsafe current version %j',
    (value) => {
      const { service, repository } = setup();
      expect(() =>
        service.setStatus(identity, 'house', 'account', 'archived', {
          version: value,
        }),
      ).toThrow();
      expect(repository.setStatus).not.toHaveBeenCalled();
    },
  );
  it.each(['1', '-1', '9007199254740991', '-9007199254740991'])(
    'accepts exact signed adjustment %s',
    (amount) => {
      const { service, repository } = setup();
      void service.adjust(identity, 'house', 'account', {
        amountMinor: amount,
        movementDate: '2026-01-01',
        version: 2,
      });
      expect(repository.adjust).toHaveBeenCalledWith(
        identity,
        'house',
        'account',
        amount,
        '2026-01-01',
        2,
      );
    },
  );
  it.each(['0', '-0', '+1', '1.0', '1e2', ' 1', '9007199254740992', 1])(
    'rejects invalid adjustment %j',
    (amount) => {
      const { service, repository } = setup();
      expect(() =>
        service.adjust(identity, 'house', 'account', {
          amountMinor: amount,
          movementDate: '2026-01-01',
          version: 1,
        }),
      ).toThrow();
      expect(repository.adjust).not.toHaveBeenCalled();
    },
  );
  it('bounds movement history pagination and rejects malformed cursors/filters', () => {
    const { service, repository } = setup();
    for (const query of [
      { limit: '101' },
      { limit: '0' },
      { limit: ['2'] },
      { cursor: 'bad' },
      { unexpected: true },
    ])
      expect(() =>
        service.movements(identity, 'house', 'account', query),
      ).toThrow();
    expect(repository.movements).not.toHaveBeenCalled();
    expect(() =>
      service.list(identity, 'house', { status: 'inactive' }),
    ).toThrow();
  });
});
