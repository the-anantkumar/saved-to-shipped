/** Provider errors are fixed messages. Never attach fetch errors or response bodies. */
export class ProviderFailure extends Error {
  readonly code: string;
  readonly uncertain: boolean;
  constructor(code: string, message: string, uncertain = false) {
    super(message);
    this.name = 'ProviderFailure';
    this.code = code;
    this.uncertain = uncertain;
  }
}

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;
export const MAX_PROVIDER_BYTES = 1_048_576;

export function credential(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(value.trim()))
    throw new ProviderFailure('CREDENTIAL_REQUIRED', 'Add a valid personal provider key in Settings.');
  return value.trim();
}

export async function providerJson(
  provider: 'Apify' | 'OpenAI', url: string, token: string, fetcher: ProviderFetch,
  { method = 'GET', body, starting = false, timeoutMs = 30_000, maxBytes = MAX_PROVIDER_BYTES }:
  { method?: 'GET' | 'POST'; body?: unknown; starting?: boolean; timeoutMs?: number; maxBytes?: number } = {},
): Promise<unknown> {
  const secret = credential(token);
  let response: Response;
  try {
    response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ProviderFailure('PROVIDER_UNREACHABLE', `${provider} did not return a confirmed response. Check your provider console.`, starting);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const messages: Record<number, string> = {
      401: `${provider} rejected the key. Check Settings.`,
      402: `${provider} requires credit in your own account.`,
      403: `${provider} denied access. Check your account permissions.`,
      429: `${provider} is rate limiting requests. Check your account before trying again.`,
    };
    throw new ProviderFailure('PROVIDER_HTTP_ERROR', messages[response.status] ?? `${provider} returned an error. Check your provider console.`, starting && response.status >= 500);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID', `${provider} returned an unreadable response.`, starting);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error();
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new ProviderFailure('PROVIDER_RESPONSE_INVALID', `${provider} returned an unreadable or oversized response. Check your provider console.`, starting);
  } finally { await reader.cancel().catch(() => {}); }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
