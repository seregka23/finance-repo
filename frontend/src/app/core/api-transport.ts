import { Service } from '@angular/core';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public availableReserveMinor?: string,
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
    await this.check(response);
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  }

  async requestBlob(path: string): Promise<Blob> {
    const response = await fetch('/api/v1' + path, { method: 'GET', credentials: 'same-origin' });
    await this.check(response);
    return response.blob();
  }

  private async check(response: Response): Promise<void> {
    if (!response.ok) {
      const data: { error?: { code?: string; message?: string; availableReserveMinor?: unknown } } =
        await response.json().catch(() => ({}));
      throw new ApiError(
        data.error?.code ?? 'REQUEST_FAILED',
        data.error?.message ?? 'Something went wrong. Please try again.',
        response.status,
        typeof data.error?.availableReserveMinor === 'string' &&
          /^(0|[1-9]\d*)$/.test(data.error.availableReserveMinor)
          ? data.error.availableReserveMinor
          : undefined,
      );
    }
  }
}
