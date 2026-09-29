import { version } from "../package.json";
import {
  ListTokens,
  GetToken,
  BatchGetTokens,
  ListTokenUsdPrices,
} from "./routes/meta/tokens";
import { GetBlock, GetClosestBlock } from "./routes/meta/blocks";
import { GetCountry } from "./routes/meta/country";
import {
  GetOverviewBoostedFeesPools,
  GetOverviewPairs,
  GetOverviewRevenue,
  GetOverviewTvl,
  GetOverviewVolume,
} from "./routes/stats/overview";
import {
  GetPairInfoPools,
  GetPairInfoTvl,
  GetPairInfoVolume,
  GetPairLiquidity,
  GetPoolTopPositions,
  GetPairTopPositions,
  ListPairEvents,
} from "./routes/stats/pair";
import { GetPoolKey, GetPoolLiquidity } from "./routes/state";
import { GetPoolKeyById, ListPoolKeys } from "./routes/state/poolKeys";
import {
  GetPairOhlcHistory,
  GetPairPriceHistory,
  GetPoolPriceHistory,
  GetTokenUsdPriceHistory,
} from "./routes/prices";
import {
  BatchListPositionsByAddress,
  GetPositionNftImage,
  GetPositionNftMetadata,
  ListPositionEvents,
  ListPositionNftEvents,
  ListPositionsByAddress,
} from "./routes/nft/positions";
import { GetOrderNftImage, GetOrderNftMetadata } from "./routes/nft/orders";
import {
  GetTwammPairState,
  GetTwammPoolState,
  GetTwammPoolStateByPoolId,
} from "./routes/twamm/getTwammPoolState";
import { BatchListTwapOrders, ListTwapOrders } from "./routes/twamm/orders";
import { ListCampaigns } from "./routes/incentives/campaigns";
import { ListRewardsForLocker } from "./routes/incentives/rewards";
import { ListClaimsForAddress } from "./routes/incentives/claims";
import {
  GetStakerInfo,
  ListProposals,
  ListProposalVoters,
  ListTopDelegates,
  ListVotesOnProposal,
} from "./routes/governance";
import { ListLimitOrders } from "./routes/limit";
import { GetNftImage, GetNftMetadata } from "./routes/nft";
import {
  GetAuctionNftImage,
  GetAuctionNftMetadata,
  GetAuctionNftState,
  ListAuctions,
} from "./routes/auctions";
import {
  ListVe33Pools,
  ListVe33TokensByAddress,
  ListVe33Voters,
} from "./routes/ve33";

import type { ApiRoute } from "./shared/context";
import { createApp } from "./shared/context";

// Registration order matters where paths overlap: a literal segment such as
// /tokens/batch or /blocks/{chainId}/closest must be registered before the
// parameterised route that would otherwise also match it.
const routes: readonly ApiRoute[] = [
  ListTokens,
  BatchGetTokens,
  ListTokenUsdPrices,
  GetToken,
  GetClosestBlock,
  GetBlock,
  GetCountry,
  GetOverviewPairs,
  GetOverviewBoostedFeesPools,
  GetOverviewRevenue,
  GetOverviewTvl,
  GetOverviewVolume,
  GetPairInfoTvl,
  GetPairInfoVolume,
  GetPairInfoPools,
  GetTokenUsdPriceHistory,
  GetPairPriceHistory,
  GetPairOhlcHistory,
  GetPoolPriceHistory,
  GetPoolLiquidity,
  GetPoolKey,
  GetPoolKeyById,
  ListPoolKeys,
  GetPairLiquidity,
  GetPairTopPositions,
  GetPoolTopPositions,
  ListPairEvents,
  BatchListPositionsByAddress,
  ListPositionsByAddress,
  ListPositionEvents,
  ListPositionNftEvents,
  GetPositionNftMetadata,
  GetOrderNftImage,
  GetOrderNftMetadata,
  GetTwammPoolState,
  GetTwammPoolStateByPoolId,
  GetTwammPairState,
  BatchListTwapOrders,
  ListTwapOrders,
  ListLimitOrders,
  GetPositionNftImage,
  GetNftMetadata,
  GetNftImage,
  ListAuctions,
  GetAuctionNftMetadata,
  GetAuctionNftState,
  GetAuctionNftImage,
  ListProposals,
  ListTopDelegates,
  ListVotesOnProposal,
  ListProposalVoters,
  GetStakerInfo,
  ListVe33Pools,
  ListVe33Voters,
  ListVe33TokensByAddress,
  ListCampaigns,
  ListRewardsForLocker,
  ListClaimsForAddress,
] as unknown as readonly ApiRoute[];

export const app = createApp();
for (const { route, handler } of routes) {
  app.openapi(route, handler);
}

export function openApiDocument() {
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
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
    servers: [
      {
        url: "https://prod-api.ekubo.org",
        description: "Production",
      },
    ],
  });
}

let document: ReturnType<typeof openApiDocument> | undefined;

app.get("/openapi.json", (c) => c.json((document ??= openApiDocument())));
// JSON is valid YAML, so the YAML path the previous router served keeps working
// without a YAML serialiser in the bundle.
app.get("/openapi.yaml", (c) =>
  c.body(JSON.stringify((document ??= openApiDocument()), null, 2), 200, {
    "content-type": "text/yaml;charset=UTF-8",
  }),
);
