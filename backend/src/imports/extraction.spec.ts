import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtractionService, parseInput, validateDraft } from './extraction.js';
import type { HouseholdAccessService } from '../households/household-access.service.js';
import type { CategoryDecisionService } from '../decisions/category-decision.js';
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
  new ExtractionService(
    key,
    access as unknown as HouseholdAccessService,
    {
      decide: vi.fn().mockResolvedValue({
        categoryId: null,
        provider: null,
        probability: null,
      }),
    } as unknown as CategoryDecisionService,
  );
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
    expect(access.get).toHaveBeenCalledTimes(3);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      model: 'gpt-4.1-mini',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
    expect(body.tools).toBeUndefined();
    expect(opts.redirect).toBe('error');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(opts.headers).get('authorization')).toBe(
      'Bearer synthetic',
    );
  });
  it('rejects multiline verbatim SMS echoes before invoking category decisions', async () => {
    const raw = 'Private notification\nverbatim';
    const decision = { decide: vi.fn() };
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
                    {
                      type: 'output_text',
                      text: JSON.stringify({ ...draft, merchant: raw }),
                    },
                  ],
                },
              ],
            }),
          ),
        ),
    );
    const extraction = new ExtractionService(
      'synthetic',
      access as unknown as HouseholdAccessService,
      decision as unknown as CategoryDecisionService,
    );
    await expect(
      extraction.extract(identity, 'h', { sourceType: 'sms', text: raw }),
    ).rejects.toMatchObject({
      status: 422,
      response: { error: { code: 'EXTRACTION_UNREADABLE' } },
    });
    expect(decision.decide).not.toHaveBeenCalled();
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
      vi.fn().mockResolvedValue(
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
      vi.fn().mockResolvedValue(
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
  it('does not retry or read provider error bodies, and caps successful bodies', async () => {
    const failed = new Response('sensitive provider body', { status: 429 });
    const text = vi.spyOn(failed, 'text');
    const cancel = vi.spyOn(failed.body!, 'cancel');
    const mock = vi
      .fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(new Response('x'.repeat(65537)));
    vi.stubGlobal('fetch', mock);
    vi.stubEnv('OPENAI_BASE_URL', 'https://invalid.example/v1');
    await expect(
      service().extract(identity, 'h', { sourceType: 'sms', text: 'private' }),
    ).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'EXTRACTION_UNAVAILABLE' } },
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(text).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    await expect(
      service().extract(identity, 'h', { sourceType: 'sms', text: 'private' }),
    ).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'EXTRACTION_UNAVAILABLE' } },
    });
    expect(mock).toHaveBeenCalledTimes(2);
    vi.unstubAllEnvs();
  });
  it('enforces the same deadline during a stalled response body', async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const pending = service().extract(identity, 'h', {
      sourceType: 'sms',
      text: 'private',
    });
    await vi.waitFor(() => expect(stream.locked).toBe(true));
    expect(timeout).toHaveBeenCalledWith(30000);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'EXTRACTION_UNAVAILABLE' } },
    });
    expect(cancel).toHaveBeenCalled();
    timeout.mockRestore();
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
