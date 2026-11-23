import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtractionService, parseInput, validateDraft } from './extraction.js';
import type { HouseholdAccessService } from '../households/household-access.service.js';
import type { Identity } from '../auth/auth.types.js';
const identity = { subject: 'user', email: 'u@example.com' } as Identity;
const draft = {
  type: 'expense',
  status: 'posted',
  date: '2026-01-02',
  amountMinor: '123',
  currency: 'RSD',
  merchant: 'Shop',
  recipient: null,
  cardLastFour: '1234',
  feeMinor: null,
  purchaseAmountMinor: null,
  purchaseCurrency: null,
  debitAmountMinor: null,
  debitCurrency: null,
  sourceAccount: null,
  destinationAccount: null,
  items: [],
};
const access = { get: vi.fn().mockResolvedValue({}) };
const service = (key: string | null = 'synthetic') =>
  new ExtractionService(key, access as unknown as HouseholdAccessService);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('recognition boundary', () => {
  it('strictly checks shape, base64 and matching signatures', () => {
    expect(parseInput({ sourceType: 'sms', text: 'paid' })).toEqual({
      sourceType: 'sms',
      text: 'paid',
    });
    for (const bad of [
      { sourceType: 'sms', text: 'x', extra: 1 },
      { sourceType: 'sms', text: ' ' },
      {
        sourceType: 'image',
        mimeType: 'image/png',
        base64: 'aGVsbG8gd29ybGQ=',
      },
      {
        sourceType: 'image',
        mimeType: 'image/svg+xml',
        base64: 'aGVsbG8gd29ybGQ=',
      },
    ])
      expect(() => parseInput(bad)).toThrow();
    expect(
      parseInput({
        sourceType: 'image',
        mimeType: 'image/png',
        base64: btoa('\x89PNG\r\n\x1a\nhello'),
      }),
    ).toMatchObject({ sourceType: 'image' });
  });
  it('uses strict output schema, store false, and rechecks membership', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(draft) }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await service().extract(identity, 'h', {
      sourceType: 'sms',
      text: 'untrusted text',
    });
    expect(result).toMatchObject({
      draft,
      reviewRequired: true,
      eligibleForPosting: false,
      reviewFlags: ['REVIEW_REQUIRED'],
    });
    expect(access.get).toHaveBeenCalledTimes(2);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      model: 'gpt-4.1-mini',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
    expect(body.tools).toBeUndefined();
  });
  it('redacts sensitive identifiers and flags unfinalized transfers and refunds', () => {
    const result = validateDraft({
      ...draft,
      type: 'transfer',
      status: 'pending',
      merchant: 'Card 4111 1111 1111 1111 CVV:123',
      recipient: 'RS35105008123123123173',
      sourceAccount: '12345678',
    });
    expect(result.reviewFlags).toContain('PENDING_SETTLEMENT');
    expect(result.reviewFlags).toContain('TRANSFER_DETAILS_REQUIRED');
    expect(result.draft.merchant).not.toContain('4111');
    expect(result.draft.merchant).not.toContain('123');
    expect(result.draft.recipient).toBe('[redacted]');
    expect(result.draft.sourceAccount).toBe('[redacted]');
    expect(validateDraft({ ...draft, type: 'refund' }).reviewFlags).toContain(
      'REFUND_LINK_REQUIRED',
    );
  });
  it('rechecks authorization after a provider response and conceals malformed content', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [
                    { type: 'output_text', text: JSON.stringify(draft) },
                  ],
                },
              ],
            }),
          ),
        ),
    );
    access.get
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('revoked'));
    await expect(
      service().extract(identity, 'h', { sourceType: 'sms', text: 'private' }),
    ).rejects.toThrow('revoked');
    access.get.mockResolvedValue({});
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [
                    { type: 'output_text', text: 'private invalid json' },
                  ],
                },
              ],
            }),
          ),
        ),
    );
    await expect(
      service().extract(identity, 'h', { sourceType: 'sms', text: 'private' }),
    ).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'EXTRACTION_INVALID_RESPONSE' } },
    });
  });
  it('rejects malformed output without exposing it and handles unavailable provider', async () => {
    for (const change of [
      { type: ['expense'] },
      { status: ['posted'] },
      { currency: 'GBP' },
      { amountMinor: '01' },
      { date: '2024-02-30' },
      { cardLastFour: '12345678' },
      { items: [{ name: 'x', quantity: '2', amountMinor: '1' }] },
    ])
      expect(() => validateDraft({ ...draft, ...change })).toThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('private details')),
    );
    await expect(
      service().extract(identity, 'h', { sourceType: 'sms', text: 'private' }),
    ).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'EXTRACTION_UNAVAILABLE' } },
    });
    await expect(
      service(null).extract(identity, 'h', {
        sourceType: 'sms',
        text: 'private',
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
