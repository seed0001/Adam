/**
 * Custom fetch for Qwen / DashScope.
 *
 * Node's Fetch API (backed by undici) requires that every HTTP header value is
 * a valid Latin-1 ByteString (all code points ≤ 255).  If the DashScope API
 * key was pasted with a stray non-Latin-1 character — most commonly an
 * ellipsis (U+2026 '…') that autocorrect inserts instead of '...' — the
 * Authorization header fails validation with an opaque ByteString error before
 * the request even leaves the process.
 *
 * This wrapper sanitises every outgoing header value to Latin-1, replacing any
 * out-of-range character with '?'.  The net effect is that a corrupt API key
 * produces a clear 401 / "Invalid API key" response from DashScope rather than
 * an unhandled crash.
 */
export const qwenFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const safeInit = init ? { ...init, headers: sanitizeHeaders(init.headers) } : init;
  return fetch(input, safeInit);
}) as typeof fetch;

function sanitizeHeaders(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (!headers) return headers;

  if (headers instanceof Headers) {
    const safe = new Headers();
    headers.forEach((value, key) => safe.set(key, toLatin1(value)));
    return safe;
  }

  if (Array.isArray(headers)) {
    return (headers as [string, string][]).map(([k, v]) => [k, toLatin1(v)]);
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    result[key] = toLatin1(value);
  }
  return result;
}

/** Replace every character outside the Latin-1 range (> U+00FF) with '?'. */
function toLatin1(value: string): string {
  return value.replace(/[^\u0000-\u00FF]/g, "?");
}
