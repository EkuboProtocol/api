import { OpenAPIRouter } from "@cloudflare/itty-router-openapi";
import { version } from "../package.json";
import { ListTokens, GetToken } from "./routes/meta/tokens";
import { GetBlock, GetClosestBlock } from "./routes/meta/blocks";
import {
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
  ListPairEvents,
} from "./routes/stats/pair";
import { GetPoolLiquidity, ListPoolKeys } from "./routes/state";
import { error } from "itty-router";
import { GetPairPriceHistory } from "./routes/prices";
import {
  GetPositionNftImage,
  GetPositionNftMetadata,
  ListPositionNftEvents,
  ListPositionsByAddress,
} from "./routes/nft/positions";
import { GetOrderNftImage, GetOrderNftMetadata } from "./routes/nft/orders";
import {
  GetTwammPairState,
  GetTwammPoolState,
} from "./routes/twamm/getTwammPoolState";
import { ListTwapOrders } from "./routes/twamm/orders";
import { ListCampaigns } from "./routes/incentives/campaigns";
import {
  ListRewardPeriods,
  ListRewardPeriodsForCampaign,
} from "./routes/incentives/rewardPeriods";
import {
  ListRewardsForAllPositions,
  ListRewardsForPosition,
} from "./routes/incentives/rewards";
import { ListClaimsForAddress } from "./routes/incentives/claims";
import { Get0xQuote } from "./routes/quote";

export const router = OpenAPIRouter({
  schema: {
    info: {
      title: "Ekubo EVM API",
      version,
      description: "API for querying data about Ekubo Protocol on EVM chains",
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
  .get(ListTokens.route, ListTokens)
  .get(GetToken.route, GetToken)
  .get(GetClosestBlock.route, GetClosestBlock)
  .get(GetBlock.route, GetBlock)
  .get(GetOverviewPairs.route, GetOverviewPairs)
  .get(GetOverviewRevenue.route, GetOverviewRevenue)
  .get(GetOverviewTvl.route, GetOverviewTvl)
  .get(GetOverviewVolume.route, GetOverviewVolume)
  .get(GetPairInfoTvl.route, GetPairInfoTvl)
  .get(GetPairInfoVolume.route, GetPairInfoVolume)
  .get(GetPairInfoPools.route, GetPairInfoPools)
  .get(GetPairPriceHistory.route, GetPairPriceHistory)
  .get(ListPoolKeys.route, ListPoolKeys)
  .get(GetPoolLiquidity.route, GetPoolLiquidity)
  .get(GetPairLiquidity.route, GetPairLiquidity)
  .get(ListPairEvents.route, ListPairEvents)
  .get(ListPositionsByAddress.route, ListPositionsByAddress)
  .get(ListPositionNftEvents.route, ListPositionNftEvents)
  .get(GetPositionNftMetadata.route, GetPositionNftMetadata)
  .get(GetOrderNftImage.route, GetOrderNftImage)
  .get(GetOrderNftMetadata.route, GetOrderNftMetadata)
  .get(GetTwammPoolState.route, GetTwammPoolState)
  .get(GetTwammPairState.route, GetTwammPairState)
  .get(ListTwapOrders.route, ListTwapOrders)
  .get(GetPositionNftImage.route, GetPositionNftImage)
  .get(ListCampaigns.route, ListCampaigns)
  .get(ListRewardPeriodsForCampaign.route, ListRewardPeriodsForCampaign)
  .get(ListRewardPeriods.route, ListRewardPeriods)
  .get(ListRewardsForPosition.route, ListRewardsForPosition)
  .get(ListRewardsForAllPositions.route, ListRewardsForAllPositions)
  .get(ListClaimsForAddress.route, ListClaimsForAddress)
  .get(Get0xQuote.route, Get0xQuote)
  // catch missed routes
  .all("*", () => error(404));
