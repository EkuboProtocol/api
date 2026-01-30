import { createCors, error, IRequest, json, StatusError } from "itty-router";
import { Env } from "./env";
import { RequestContext } from "./shared/context";
import { router } from "./router";

function normalizeQueryValue(key: string, value: string): string {
  if (key.toLowerCase() === "chainid") {
    try {
      return BigInt(value).toString();
    } catch {
      return value;
    }
  }

  return value;
}

function normalizeRequestForCache(request: IRequest): URL {
  const url = new URL(request.url);
  const params = Array.from(url.searchParams.entries());

  if (params.length === 0) {
    return url;
  }

  const normalizedParams = new URLSearchParams();
  params
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    )
    .forEach(([key, value]) =>
      normalizedParams.append(key, normalizeQueryValue(key, value)),
    );

  const normalizedUrl = new URL(url.toString());
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

const { preflight, corsify } = createCors({
  maxAge: 86400,
  origins: ["*"],
  methods: ["GET", "OPTIONS"],
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
      const cached = false;
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
