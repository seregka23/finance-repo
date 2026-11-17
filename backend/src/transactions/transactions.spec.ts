import { describe, expect, it, vi } from 'vitest';
import { TransactionsService, transfer } from './transactions.service.js';
import type { PostingRepository } from './posting.repository.js';
import type { Identity } from '../auth/auth.js';

const identity = { subject: 'user', email: 'user@example.com' } as Identity;
const base = {
  type: 'expense',
  transactionDate: '2024-02-29',
  accountId: 'account',
  categoryId: 'category',
  amountMinor: '123',
  currency: 'RSD',
  exchangeRate: null,
  exchangeRateSource: null,
  merchant: null,
  note: null,
};
function setup() {
  const repo = {
    post: vi.fn(),
    edit: vi.fn(),
    void: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  };
  return {
    repo,
    service: new TransactionsService(repo as unknown as PostingRepository),
  };
}
describe('transaction validation', () => {
  it('normalizes equivalent optional fields and FX rates before posting', () => {
    const { service, repo } = setup();
    void service.create(
      identity,
      'h',
      {
        ...base,
        currency: 'EUR',
        exchangeRate: '00117.5000',
        exchangeRateSource: ' bank ',
        merchant: ' shop ',
      },
      'key',
    );
    expect(repo.post).toHaveBeenCalledWith(
      identity,
      'h',
      {
        ...base,
        currency: 'EUR',
        exchangeRate: '117.5',
        exchangeRateSource: 'bank',
        merchant: 'shop',
      },
      'key',
    );
    const {
      exchangeRate: _r,
      exchangeRateSource: _s,
      merchant: _m,
      note: _n,
      ...minimal
    } = base;
    void service.create(identity, 'h', minimal, 'key');
    expect(repo.post).toHaveBeenLastCalledWith(identity, 'h', base, 'key');
  });
  it.each([
    { transactionDate: '2023-02-29' },
    { amountMinor: '0' },
    { amountMinor: '-1' },
    { amountMinor: '01' },
    { amountMinor: '9007199254740992' },
    { currency: 'EUR' },
    { currency: 'EUR', exchangeRate: '0', exchangeRateSource: 'bank' },
    {
      currency: 'EUR',
      exchangeRate: '999999999999999999',
      exchangeRateSource: 'bank',
    },
    { exchangeRate: '1' },
    { extra: true },
  ])('rejects invalid input %o', (change) => {
    const { service, repo } = setup();
    expect(() =>
      service.create(identity, 'h', { ...base, ...change }, 'key'),
    ).toThrow();
    expect(repo.post).not.toHaveBeenCalled();
  });
  it.each([undefined, '', ' ', 'a b', 'x'.repeat(129)])(
    'rejects invalid key %s',
    (key) => {
      const { service } = setup();
      expect(() => service.create(identity, 'h', base, key)).toThrow();
    },
  );
  it('validates list pagination and decodes returned cursors', () => {
    const { service, repo } = setup();
    void service.list(identity, 'h', {});
    expect(repo.list).toHaveBeenLastCalledWith(identity, 'h', {
      limit: 50,
      cursor: null,
    });
    const cursor = btoa(
      JSON.stringify({ transactionDate: '2024-02-29', id: 'abc' }),
    )
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    void service.list(identity, 'h', { limit: '2', cursor });
    expect(repo.list).toHaveBeenLastCalledWith(identity, 'h', {
      limit: 2,
      cursor: { transactionDate: '2024-02-29', id: 'abc' },
    });
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { cursor: 'bad' },
      { unknown: 'x' },
    ]) {
      expect(() => service.list(identity, 'h', query)).toThrow();
    }
  });
  it('normalizes blank optional text to null', () => {
    const { service, repo } = setup();
    void service.create(
      identity,
      'h',
      { ...base, merchant: '  ', note: ' ' },
      'key',
    );
    expect(repo.post).toHaveBeenCalledWith(identity, 'h', base, 'key');
  });
  it('requires full replacement and safe versions for edit and void', () => {
    const { service, repo } = setup();
    expect(() =>
      service.edit(identity, 'h', 'id', {
        ...base,
        version: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(() =>
      service.edit(identity, 'h', 'id', { type: 'expense', version: 1 }),
    ).toThrow();
    expect(() => service.void(identity, 'h', 'id', { version: 0 })).toThrow();
    expect(() =>
      service.void(identity, 'h', 'id', { version: 1, extra: true }),
    ).toThrow();
    void service.edit(identity, 'h', 'id', { ...base, version: 1 });
    expect(repo.edit).toHaveBeenCalledWith(identity, 'h', 'id', base, 1);
    void service.void(identity, 'h', 'id', { version: 2 });
    expect(repo.void).toHaveBeenCalledWith(identity, 'h', 'id', 2);
  });
});

describe('transfer normalization', () => {
  const input = {
    type: 'transfer',
    transactionDate: '2024-02-29',
    fromAccountId: 'from',
    toAccountId: 'to',
    debitAmountMinor: '100',
    creditAmountMinor: '100',
    debitCurrency: 'RSD',
    creditCurrency: 'RSD',
  };
  it('normalizes a foreign-currency fee without deriving principal amounts', () => {
    expect(
      transfer({
        ...input,
        debitCurrency: 'EUR',
        creditAmountMinor: '11700',
        fee: {
          amountMinor: '2',
          categoryId: 'c',
          exchangeRate: '00117.500',
          exchangeRateSource: ' bank ',
        },
      }),
    ).toMatchObject({
      debitAmountMinor: '100',
      creditAmountMinor: '11700',
      fee: {
        amountMinor: '2',
        categoryId: 'c',
        exchangeRate: '117.5',
        exchangeRateSource: 'bank',
      },
    });
  });
  it.each([
    { toAccountId: 'from' },
    { debitAmountMinor: '01' },
    { debitAmountMinor: '0' },
    { creditAmountMinor: '101' },
    { debitAmountMinor: '9007199254740992' },
    { fee: { amountMinor: '1', categoryId: 'c', exchangeRate: '1' } },
    { fee: { amountMinor: '1', categoryId: 'c', extra: true } },
    {
      debitCurrency: 'EUR',
      fee: {
        amountMinor: '1',
        categoryId: 'c',
        exchangeRate: '0.1',
        exchangeRateSource: 'bank',
      },
    },
    { extra: true },
  ])('rejects invalid transfer %o', (change) => {
    expect(() => transfer({ ...input, ...change })).toThrow();
  });
  it('routes normalized creates and replacements through the shared repository', () => {
    const { service, repo } = setup();
    void service.create(identity, 'h', input, 'key');
    expect(repo.post).toHaveBeenCalledWith(
      identity,
      'h',
      { ...input, fee: null, merchant: null, note: null },
      'key',
    );
    expect(() => service.create(identity, 'h', input, 'bad key')).toThrow();
    expect(() =>
      service.edit(identity, 'h', 'id', { ...input, version: 0 }),
    ).toThrow();
    void service.edit(identity, 'h', 'id', {
      ...input,
      fee: null,
      merchant: null,
      note: null,
      version: 3,
    });
    expect(repo.edit).toHaveBeenCalledWith(
      identity,
      'h',
      'id',
      { ...input, fee: null, merchant: null, note: null },
      3,
    );
  });
  it('requires all fields for replacement', () => {
    expect(() => transfer(input, true)).toThrow();
    expect(
      transfer({ ...input, fee: null, merchant: null, note: null }, true).fee,
    ).toBeNull();
  });
});
