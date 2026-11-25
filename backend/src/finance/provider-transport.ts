import OpenAI from 'openai';

export async function readProviderBody(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('provider');
  const decoder = new TextDecoder();
  let text = '',
    size = 0;
  let onAbort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new Error('provider timeout'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (signal.aborted) throw new Error('provider timeout');
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) {
        void reader.cancel().catch(() => undefined);
        throw new Error('provider');
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
export function createOpenAIClient(
  key: string,
  endpoint: 'responses' | 'decisions',
  timeout: number,
): OpenAI {
  return new OpenAI({
    apiKey: key,
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: 'https://api.openai.com/v1',
    maxRetries: 0,
    timeout,
    logLevel: 'off',
    fetch: async (url, options) => {
      const target =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target !== `https://api.openai.com/v1/${endpoint}`)
        throw new Error('provider');
      const headers = new Headers(options?.headers),
        safe = new Headers();
      for (const name of ['authorization', 'content-type', 'accept']) {
        const value = headers.get(name);
        if (value !== null) safe.set(name, value);
      }
      const response = await globalThis.fetch(url, {
        ...options,
        headers: safe,
        redirect: 'error',
      });
      if (!response.ok) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new Error('provider');
      }
      return response;
    },
  });
}
