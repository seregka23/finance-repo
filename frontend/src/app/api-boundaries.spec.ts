import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Api, ApiError } from './api';

describe('API boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends cookie credentials and handles an empty successful response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const api = TestBed.inject(Api);
    await expect(api.request('/items/one', 'DELETE')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/items/one', {
      method: 'DELETE', credentials: 'same-origin',
    });
  });

  it('refreshes the household list after access is lost', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      user: { email: 'a@example.com' }, households: [{ id: 'remaining' }],
    })));
    const api = TestBed.inject(Api);
    api.selectedId.set('removed');
    const message = await api.handleError(new ApiError('HOUSEHOLD_NOT_FOUND', 'missing', 404));
    expect(message).toContain('no longer available');
    expect(api.selectedId()).toBe('remaining');
    expect(api.session()?.user.email).toBe('a@example.com');
  });
});
