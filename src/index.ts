import { cors, error, IRequest, json, StatusError } from "itty-router";
import { Env } from "./env";
import { RequestContext } from "./shared/context";
import { router } from "./router";

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

function normalizeRequestForCache(request: IRequest): URL {
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

function getCacheKey(request: IRequest): URL | null {
  if (request.method.toLowerCase() !== "get") {
    return null;
  }

  return normalizeRequestForCache(request);
}

const cache = caches.default;

const { preflight, corsify } = cors({
  maxAge: 86400,
  origin: "*",
  allowMethods: ["GET", "OPTIONS"],
});

export default {
  fetch: async (request: IRequest, env: Env) => {
    // first check the preflight before anything. it's so cheap to handle we shouldn't even bother with check the cache
    const preflightResponse = preflight(request);
    if (preflightResponse) return preflightResponse;

    const cacheKey = getCacheKey(request);
    // check cache hits for request
    // we do this outside of the router because we do not want to RE-CACHE a successful response by including the cache logic in the router handler
    if (cacheKey) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const corsified = corsify(cached);
        corsified.headers.set("Access-Control-Allow-Origin", "*");
        return corsified;
      }
    }

    let response: Response;
    try {
      response = json(
        await router.handle(request, { env } satisfies RequestContext),
      );
    } catch (e) {
      if (e instanceof StatusError) {
        response = error(e);
      } else {
        console.error(e);
        response = json(error(500, "Internal server error"));
      }
    }

    if (cacheKey && response.ok) {
      await cache.put(cacheKey, response.clone());
    }

    const corsified = corsify(response);
    corsified.headers.set("Access-Control-Allow-Origin", "*");
    return corsified;
  },
};
