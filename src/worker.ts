import { Env } from "./env";
import { notModified, withEtag } from "./shared/etag";
import {
  fromStoredResponse,
  refreshOnce,
  toStoredResponse,
} from "./shared/staleWhileRevalidate";

const NUMERICISH_REGEX = /^(?:0x[0-9a-fA-F]+|[+-]?\d+)$/;
const MAX_NUMERICISH_LENGTH = 128;

function normalizeNumberishValue(value: string): string {
  if (value.length === 0 || value.length > MAX_NUMERICISH_LENGTH) {
    return value;
  }

  if (!NUMERICISH_REGEX.test(value)) {
    return value;
  }

  try {
    return BigInt(value).toString();
  } catch {
    return value;
  }
}

function normalizeRequestForCache(request: Request): URL {
  const url = new URL(request.url);
  const normalizedUrl = new URL(url.toString());

  // Canonicalize integer-like path segments, e.g. /0x123 -> /291.
  const normalizedPathSegments = normalizedUrl.pathname
    .split("/")
    .map((segment) => normalizeNumberishValue(segment));
  normalizedUrl.pathname = normalizedPathSegments.join("/");

  const params = Array.from(normalizedUrl.searchParams.entries());

  if (params.length === 0) {
    return normalizedUrl;
  }

  const normalizedParams = new URLSearchParams();
  params
    .map(([key, value]) => [key, normalizeNumberishValue(value)] as const)
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    )
    .forEach(([key, value]) => normalizedParams.append(key, value));
  normalizedUrl.search = normalizedParams.toString();

  return normalizedUrl;
}

function getCacheKey(request: Request): URL | null {
  if (request.method.toLowerCase() !== "get") {
    return null;
  }

  return normalizeRequestForCache(request);
}

function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;

  const headers = new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-max-age": "86400",
  });
  const requestedHeaders = request.headers.get(
    "access-control-request-headers",
  );
  if (requestedHeaders) {
    headers.set("access-control-allow-headers", requestedHeaders);
  }
  return new Response(null, { status: 204, headers });
}

function finalize(request: Request, response: Response): Response {
  const final = notModified(request, response) ?? response;
  // Cached responses have immutable headers, so copy before adding CORS.
  const headers = new Headers(final.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(final.body, {
    status: final.status,
    statusText: final.statusText,
    headers,
  });
}

export interface App {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Response | Promise<Response>;
}

async function store(cacheKey: URL, response: Response): Promise<Response> {
  const tagged = await withEtag(response);
  await caches.default.put(
    cacheKey,
    toStoredResponse(tagged.clone(), Date.now()),
  );
  return tagged;
}

function refreshInBackground(
  app: App,
  request: Request,
  cacheKey: URL,
  env: Env,
  ctx: ExecutionContext,
) {
  const refresh = refreshOnce(cacheKey.href, async () => {
    const response = await app.fetch(
      new Request(request.url, { method: "GET" }),
      env,
      ctx,
    );
    if (response.ok) await store(cacheKey, response);
  });
  if (refresh) ctx.waitUntil(refresh);
}

export const createWorker = (app: App) => ({
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    // first check the preflight before anything. it's so cheap to handle we shouldn't even bother with check the cache
    const preflightResponse = preflight(request);
    if (preflightResponse) return preflightResponse;

    const cacheKey = getCacheKey(request);
    // check cache hits for request
    // we do this outside of the router because we do not want to RE-CACHE a successful response by including the cache logic in the router handler
    if (cacheKey) {
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const { response, stale } = fromStoredResponse(cached, Date.now());
        if (stale) refreshInBackground(app, request, cacheKey, env, ctx);
        return finalize(request, response);
      }
    }

    let response = await app.fetch(request, env, ctx);

    if (cacheKey && response.ok) {
      response = await store(cacheKey, response);
    }

    return finalize(request, response);
  },
});
