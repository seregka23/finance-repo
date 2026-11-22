import { describe, expect, it } from 'vitest';
import { summarizePlans } from './plans.js';

const row = {
  id: 'p',
  month: '2026-01',
  categoryId: 'c',
  categoryName: 'Food',
  categoryStatus: 'active',
  limitMinor: '1000',
  movementId: null,
  currency: null,
  amountMinor: null,
  rsdEquivalentMinor: null,
  exchangeRate: null,
};
describe('budget reporting', () => {
  it('nets signed expenses and refunds without floating point and computes overspending', () => {
    expect(
      summarizePlans([
        { ...row, movementId: 'a', currency: 'RSD', amountMinor: '-1500' },
        { ...row, movementId: 'b', currency: 'RSD', amountMinor: '200' },
      ])[0],
    ).toMatchObject({
      actualMinor: '1300',
      remainingMinor: '-300',
      overspentMinor: '300',
      utilizationBasisPoints: '13000',
      missingFxCount: 0,
    });
  });
  it('handles zero limits and signed half-away-from-zero rounding', () => {
    expect(summarizePlans([{ ...row, limitMinor: '0' }])[0]).toMatchObject({
      actualMinor: '0',
      remainingMinor: '0',
      overspentMinor: '0',
      utilizationBasisPoints: null,
    });
    expect(
      summarizePlans([
        {
          ...row,
          limitMinor: '20000',
          movementId: 'r',
          currency: 'RSD',
          amountMinor: '1',
        },
      ])[0],
    ).toMatchObject({
      actualMinor: '-1',
      remainingMinor: '20001',
      overspentMinor: '0',
      utilizationBasisPoints: '-1',
    });
  });
  it('retains known FX subtotal while marking missing value or rate incomplete', () => {
    expect(
      summarizePlans([
        {
          ...row,
          movementId: 'a',
          currency: 'EUR',
          amountMinor: '-100',
          rsdEquivalentMinor: '-12000',
          exchangeRate: '120',
        },
        {
          ...row,
          movementId: 'b',
          currency: 'EUR',
          amountMinor: '-10',
          rsdEquivalentMinor: null,
          exchangeRate: null,
        },
        {
          ...row,
          movementId: 'c',
          currency: 'EUR',
          amountMinor: '-5',
          rsdEquivalentMinor: '-600',
          exchangeRate: null,
        },
      ])[0],
    ).toMatchObject({
      actualMinor: '12600',
      missingFxCount: 2,
      remainingMinor: null,
      overspentMinor: null,
      utilizationBasisPoints: null,
    });
  });
});
