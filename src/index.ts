import { createCors, error, IRequest, json, StatusError } from "itty-router";
import { Env } from "./env";
import Decimal from "decimal.js-light";
import { RequestContext } from "./shared/context";
import { router } from "./router";

Decimal.set({ precision: 39 });

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

    const cacheable = request.method.toLowerCase() === "get";
    // check cache hits for request
    // we do this outside of the router because we do not want to RE-CACHE a successful response by including the cache logic in the router handler
    if (cacheable) {
      const cached = await cache.match(request);
      if (cached) {
        const corsified = corsify(cached);

        corsified.headers.set("Vary", "Origin");
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

    if (cacheable && response.ok) {
      await cache.put(request, response.clone());
    }

    const corsified = corsify(response);
    corsified.headers.set("Vary", "Origin");
    return corsified;
  },
};
