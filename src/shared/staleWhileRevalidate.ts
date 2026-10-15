const STORED_AT_HEADER = "x-ekubo-stored-at";
const CACHE_CONTROL_HEADER = "x-ekubo-cache-control";

interface SwrPolicy {
  maxAge: number;
  staleWhileRevalidate: number;
}

function directive(cacheControl: string, name: string): number | null {
  const match = new RegExp(`(?:^|[\\s,])${name}=(\\d+)`, "i").exec(
    cacheControl,
  );
  return match ? Number(match[1]) : null;
}

export function parseSwrPolicy(cacheControl: string | null): SwrPolicy | null {
  if (!cacheControl) return null;
  const maxAge = directive(cacheControl, "max-age");
  const staleWhileRevalidate = directive(
    cacheControl,
    "stale-while-revalidate",
  );
  if (maxAge === null || !staleWhileRevalidate) return null;
  return { maxAge, staleWhileRevalidate };
}

export function toStoredResponse(response: Response, now: number): Response {
  const cacheControl = response.headers.get("cache-control");
  const policy = parseSwrPolicy(cacheControl);
  if (!policy || cacheControl === null) return response;

  const headers = new Headers(response.headers);
  headers.set(CACHE_CONTROL_HEADER, cacheControl);
  headers.set(STORED_AT_HEADER, String(now));
  headers.set(
    "cache-control",
    `public, max-age=${policy.maxAge + policy.staleWhileRevalidate}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function fromStoredResponse(
  stored: Response,
  now: number,
): { response: Response; stale: boolean } {
  const cacheControl = stored.headers.get(CACHE_CONTROL_HEADER);
  const storedAt = Number(stored.headers.get(STORED_AT_HEADER));
  if (cacheControl === null || !Number.isFinite(storedAt)) {
    return { response: stored, stale: false };
  }

  const headers = new Headers(stored.headers);
  headers.delete(CACHE_CONTROL_HEADER);
  headers.delete(STORED_AT_HEADER);
  headers.set("cache-control", cacheControl);
  const response = new Response(stored.body, {
    status: stored.status,
    statusText: stored.statusText,
    headers,
  });

  const maxAge = parseSwrPolicy(cacheControl)?.maxAge ?? 0;
  return { response, stale: now - storedAt > maxAge * 1000 };
}

const refreshing = new Set<string>();

export function refreshOnce(key: string, refresh: () => Promise<void>) {
  if (refreshing.has(key)) return null;
  refreshing.add(key);
  return refresh().finally(() => refreshing.delete(key));
}
