import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CategoryDecisionService,
  type CategoryDecisionConfig,
} from './category-decision.js';
import type { CategoryService } from '../categories/categories.js';
import type { Identity } from '../auth/auth.types.js';
const user = { subject: 'member', email: 'private@example.com' } as Identity;
const draft = {
  type: 'expense',
  status: 'posted',
  merchant: 'Bakery',
  recipient: null,
  items: [{ name: 'bread' }],
};
const candidate = {
  id: 'secret-id',
  name: 'Food',
  type: 'expense',
  status: 'active',
  createdAt: '',
  updatedAt: '',
};
const cats = { listEligible: vi.fn() };
const create = (config: CategoryDecisionConfig) =>
  new CategoryDecisionService(config, cats as unknown as CategoryService);
const openai = (
  choice = 'c0',
  probability: unknown = 0.9,
  model = 'gpt-6-luna',
) => ({
  model,
  answers: [
    {
      type: 'choice',
      name: 'category',
      choice,
      probabilities: [{ value: choice, probability }],
    },
  ],
});
const gemini = (choice = 'c0', probability: unknown = 0.9) => ({
  answers: {
    category: {
      type: 'choice',
      choice,
      probabilities: { [choice]: probability },
    },
  },
});
function mock(value: unknown) {
  const fn = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
describe('category decisions', () => {
  it('uses OpenAI choice with aliases and rechecks eligible category', async () => {
    cats.listEligible.mockResolvedValue([candidate]);
    const fetch = mock(openai());
    const result = await create({ openaiKey: 'fake' }).decide(
      user,
      'house',
      draft,
    );
    expect(result).toEqual({
      categoryId: 'secret-id',
      provider: 'openai',
      probability: 0.9,
    });
    expect(cats.listEligible).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    const data = JSON.parse(init.body);
    expect(data.model).toBe('gpt-6-luna');
    expect(data.questions[0].choices).toEqual([
      { value: 'c0', description: 'Food' },
      { value: 'needs_review', description: expect.any(String) },
    ]);
    expect(init.body).not.toContain('secret-id');
    expect(init.body).not.toContain('private@example.com');
  });
  it('uses Gemini choice map and its own threshold', async () => {
    cats.listEligible.mockResolvedValue([candidate]);
    const fetch = mock(gemini('c0', 0.75));
    expect(
      await create({
        provider: 'GEMINI',
        geminiKey: 'fake',
        geminiMinProbability: '0.7',
        openaiMinProbability: '0.99',
      }).decide(user, 'house', draft),
    ).toEqual({
      categoryId: 'secret-id',
      provider: 'gemini',
      probability: 0.75,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/decisions',
    );
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gemini-decision-1',
      questions: { category: { type: 'choice', criteria: { c0: 'Food' } } },
    });
  });
  it('returns manual on low probability, needs review, refusal and mismatched provider shape', async () => {
    cats.listEligible.mockResolvedValue([candidate]);
    for (const [payload, expected] of [
      [openai('c0', 0.79), 0.79],
      [openai('needs_review', 0.99), 0.99],
      [
        {
          model: 'gpt-6-luna',
          answers: [{ type: 'refusal', name: 'category' }],
        },
        null,
      ],
      [gemini('c0', 0.99), null],
      [openai('unknown', 0.99), null],
      [openai('c0', null), null],
    ] as const) {
      mock(payload);
      expect(
        await create({ openaiKey: 'fake' }).decide(user, 'house', draft),
      ).toEqual({
        categoryId: null,
        provider: 'openai',
        probability: expected,
      });
    }
  });
  it('handles Gemini low scores, needs-review, refusals and provider mismatch', async () => {
    cats.listEligible.mockResolvedValue([candidate]);
    for (const [payload, probability] of [
      [gemini('c0', 0.4), 0.4],
      [gemini('needs_review', 0.9), 0.9],
      [{ answers: { category: { type: 'refusal' } } }, null],
      [openai(), null],
      [gemini('c0', null), null],
      [gemini('alien', 0.9), null],
    ] as const) {
      mock(payload);
      expect(
        await create({ provider: 'gemini', geminiKey: 'fake' }).decide(
          user,
          'house',
          draft,
        ),
      ).toEqual({ categoryId: null, provider: 'gemini', probability });
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private')));
    expect(
      await create({ provider: 'gemini', geminiKey: 'fake' }).decide(
        user,
        'house',
        draft,
      ),
    ).toEqual({ categoryId: null, provider: 'gemini', probability: null });
  });
  it('skips invalid configuration, unsupported types, empty evidence and missing categories', async () => {
    const fetch = mock(openai());
    cats.listEligible.mockResolvedValue([]);
    for (const [config, input] of [
      [{ provider: 'invalid', openaiKey: 'fake' }, draft],
      [{ openaiKey: 'fake', openaiMinProbability: 'oops' }, draft],
      [{ openaiKey: 'fake' }, { ...draft, type: 'refund' }],
      [{ openaiKey: 'fake' }, { ...draft, status: 'declined' }],
      [{ openaiKey: 'fake' }, { ...draft, merchant: null, items: [] }],
      [{ openaiKey: 'fake' }, draft],
    ] as const) {
      expect(await create(config).decide(user, 'house', input)).toEqual({
        categoryId: null,
        provider: null,
        probability: null,
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails soft and never returns a category archived while the provider was running', async () => {
    cats.listEligible
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([]);
    mock(openai());
    expect(
      await create({ openaiKey: 'fake' }).decide(user, 'house', draft),
    ).toEqual({ categoryId: null, provider: 'openai', probability: 0.9 });
    cats.listEligible.mockResolvedValue([candidate]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sensitive')));
    expect(
      await create({ openaiKey: 'fake' }).decide(user, 'house', draft),
    ).toEqual({ categoryId: null, provider: 'openai', probability: null });
  });
  it('uses income categories for income and expense categories for fees', async () => {
    cats.listEligible.mockResolvedValue([candidate]);
    mock(openai('needs_review', 0.9));
    await create({ openaiKey: 'fake' }).decide(user, 'house', {
      ...draft,
      type: 'income',
    });
    await create({ openaiKey: 'fake' }).decide(user, 'house', {
      ...draft,
      type: 'fee',
    });
    expect(cats.listEligible).toHaveBeenNthCalledWith(
      1,
      user,
      'house',
      'income',
    );
    expect(cats.listEligible).toHaveBeenNthCalledWith(
      2,
      user,
      'house',
      'expense',
    );
  });
});
