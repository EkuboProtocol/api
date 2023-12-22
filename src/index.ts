import { createCors, error, IRequest, json } from "itty-router";
import { Env } from "./env";
import Decimal from "decimal.js-light";
import { version } from "../package.json";
import { OpenAPIRouter } from "@cloudflare/itty-router-openapi";
import { GetTokenLogo, GetTokens } from "./routes/meta/tokens";
import {
  GetLeaderboard,
  GetLeaderboardDump,
  GetLeaderboardForCollector,
} from "./routes/leaderboard";
import { GetBlock } from "./routes/meta/blocks";
import { GetQuote, GetQuoteToPrice } from "./routes/quote";
import { GetOverview } from "./routes/charts/overview";
import {
  GetPairInfo,
  GetPairLiquidity,
  ListPairEvents,
} from "./routes/charts/pair";
import {
  GetPairPrice,
  GetPairPriceHistory,
  GetTokenPrices,
} from "./routes/price";
import { GetPoolLiquidity, GetPoolStates } from "./routes/state";
import { ListPositions } from "./routes/positions";
import { GetNftImage, GetNftMetadata, ListNftEvents } from "./routes/nft";

Decimal.set({ precision: 39 });

const router = OpenAPIRouter({
  schema: {
    info: {
      title: "Ekubo API",
      version,
      description: "API for querying data about Ekubo Protocol",
      contact: {
        url: "https://ekubo.org",
        email: "eng@ekubo.org",
      },
    },
    externalDocs: {
      url: "https://docs.ekubo.org",
      description: "The docs website for Ekubo Protocol",
    },
  },
  // removes the redoc and docs urls because they might increase the bundle size/js load time
  redoc_url: null as unknown as undefined,
  docs_url: null as unknown as undefined,
})
  .get("/tokens", GetTokens)
  .get("/tokens/:identifier/logo", GetTokenLogo)
  .get("/blocks/:number", GetBlock)
  // gets a full dump of the leaderboard
  .get("/leaderboard/dump", GetLeaderboardDump)
  .get("/leaderboard", GetLeaderboard)
  .get("/leaderboard/:collector/points", GetLeaderboardForCollector)
  .get("/quote/:amount/:token/:otherToken", GetQuote)
  .get("/overview", GetOverview)
  .get("/pair/:tokenA/:tokenB", GetPairInfo)
  .get("/price/:baseToken/:quoteToken", GetPairPrice)
  .get(GetPairPriceHistory.route, GetPairPriceHistory)
  .get("/price/:quoteToken", GetTokenPrices)
  .get("/pools", GetPoolStates)
  .get("/pools/:key_hash/liquidity", GetPoolLiquidity)
  .get("/pools/:key_hash/delta_to_sqrt_ratio/:new_sqrt_ratio", GetQuoteToPrice)
  .get("/positions/:address", ListPositions)
  .get("/tokens/:tokenA/:tokenB/liquidity", GetPairLiquidity)
  .get("/tokens/:tokenA/:tokenB/events", ListPairEvents)
  .get("/:id", GetNftMetadata)
  .get("/:id/history", ListNftEvents)
  .get("/:id/image.svg", GetNftImage)
  // catch missed routes
  .all("*", () => error(404));

const cache = caches.default;

const { preflight, corsify } = createCors({
  maxAge: 86400,
  origins: ["*"],
  methods: ["GET", "OPTIONS", "POST"],
});

export default {
  fetch: async (request: IRequest, env: Env) => {
    // first check the preflight before anything. it's so cheap to handle we shouldn't even bother with check the cache
    const preflightResponse = preflight(request);
    if (preflightResponse) return preflightResponse;

    // check cache hits for request
    // we do this outside of the router because we do not want to RE-CACHE a successful response by including the cache logic in the router handler
    const cached = await cache.match(request);
    if (cached) {
      return corsify(cached);
    }

    let response: Response;
    try {
      response = json(await router.handle(request, env));
    } catch (e) {
      console.error(e);
      response = json(error(500, "Internal server error"));
    }

    if (response.ok) {
      await cache.put(request, response.clone());
    }

    return corsify(response);
  },
};
