import {createCors, error, IRequest, json} from "itty-router";
import {Env} from "./env";
import Decimal from "decimal.js-light";
import {version} from "../package.json";
import {OpenAPIRouter} from "@cloudflare/itty-router-openapi";
import {GetTokenLogo, ListTokens} from "./routes/meta/tokens";
import {GetLeaderboard, GetLeaderboardForCollector} from "./routes/leaderboard";
import {GetBlock} from "./routes/meta/blocks";
import {GetQuote, GetQuoteToPrice} from "./routes/quote";
import {GetOverview} from "./routes/stats/overview";
import {GetPairInfo, GetPairLiquidity, ListPairEvents,} from "./routes/stats/pair";
import {GetPairPrice, GetPairPriceHistory, GetTokenPrices,} from "./routes/prices";
import {GetPoolKeyHash, GetPoolLiquidity, GetPoolStates} from "./routes/state";
import {GetNftImage, GetNftMetadata, ListNftEvents, ListPositions} from "./routes/nft";
import {RequestContext} from "./shared/context";
import {IntractApiRoute} from "./routes/intract";
import {GetDefiSpringIncentives} from "./routes/meta/get-defi-spring-incentives";

Decimal.set({precision: 39});

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
            description: "Official documentation",
        },
    },
    // removes the redoc and docs urls because they might increase the bundle size/js load time
    redoc_url: null as unknown as undefined,
    docs_url: null as unknown as undefined,
})
    .get(GetDefiSpringIncentives.route, GetDefiSpringIncentives)
    .get(ListTokens.route, ListTokens)
    .get(GetTokenLogo.route, GetTokenLogo)
    .get(GetBlock.route, GetBlock)
    .get(GetLeaderboard.route, GetLeaderboard)
    .get(GetLeaderboardForCollector.route, GetLeaderboardForCollector)
    .get(GetQuote.route, GetQuote)
    .get(GetOverview.route, GetOverview)
    .get(GetPairInfo.route, GetPairInfo)
    .get(GetPairPrice.route, GetPairPrice)
    .get(GetPairPriceHistory.route, GetPairPriceHistory)
    .get(GetTokenPrices.route, GetTokenPrices)
    .get(GetPoolStates.route, GetPoolStates)
    .get(GetPoolKeyHash.route, GetPoolKeyHash)
    .get(GetPoolLiquidity.route, GetPoolLiquidity)
    .get(GetQuoteToPrice.route, GetQuoteToPrice)
    .get(ListPositions.route, ListPositions)
    .get(GetPairLiquidity.route, GetPairLiquidity)
    .get(ListPairEvents.route, ListPairEvents)
    .get(GetNftMetadata.route, GetNftMetadata)
    .get(ListNftEvents.route, ListNftEvents)
    .get(GetNftImage.route, GetNftImage)
    .post(IntractApiRoute.route, IntractApiRoute)
    // catch missed routes
    .all("*", () => error(404));

const cache = caches.default;

const {preflight, corsify} = createCors({
    maxAge: 86400,
    origins: ["*"],
    methods: ["GET", "OPTIONS", "POST"],
});

export default {
    fetch: async (request: IRequest, env: Env) => {
        // first check the preflight before anything. it's so cheap to handle we shouldn't even bother with check the cache
        const preflightResponse = preflight(request);
        if (preflightResponse) return preflightResponse;

        const cacheable = request.method.toLowerCase() === 'get'
        // check cache hits for request
        // we do this outside of the router because we do not want to RE-CACHE a successful response by including the cache logic in the router handler
        if (cacheable) {
            const cached = await cache.match(request);
            if (cached) {
                return corsify(cached);
            }
        }

        let response: Response;
        try {
            response = json(await router.handle(request, {env} satisfies RequestContext));
        } catch (e) {
            console.error(e);
            response = json(error(500, "Internal server error"));
        }

        if (cacheable && response.ok) {
            await cache.put(request, response.clone());
        }

        return corsify(response);
    },
};