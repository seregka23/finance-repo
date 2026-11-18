import { Service } from '@angular/core';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

@Service()
export class ApiTransport {
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const response = await fetch('/api/v1' + path, {
      method,
      credentials: 'same-origin',
      ...(body !== undefined || Object.keys(headers).length
        ? {
            headers: {
              ...headers,
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
          }
        : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data: { error?: { code?: string; message?: string } } = await response
        .json()
        .catch(() => ({}));
      throw new ApiError(
        data.error?.code ?? 'REQUEST_FAILED',
        data.error?.message ?? 'Something went wrong. Please try again.',
        response.status,
      );
    }
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  }
}
