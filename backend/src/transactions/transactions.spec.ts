import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service.js';
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
