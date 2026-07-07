import { OpenAPIRouter } from "@cloudflare/itty-router-openapi";
import { version } from "../package.json";
import { ListTokens, GetToken, BatchGetTokens } from "./routes/meta/tokens";
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
import { error } from "itty-router";
import { GetPairPriceHistory, GetPoolPriceHistory } from "./routes/prices";
import {
  BatchListPositionsByAddress,
  GetPositionNftImage,
  GetPositionNftMetadata,
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
import { ListVe33TokensByAddress } from "./routes/ve33";

export const router = OpenAPIRouter({
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
  .get(ListTokens.route, ListTokens)
  .get(BatchGetTokens.route, BatchGetTokens)
  .get(GetToken.route, GetToken)
  .get(GetClosestBlock.route, GetClosestBlock)
  .get(GetBlock.route, GetBlock)
  .get(GetCountry.route, GetCountry)
  .get(GetOverviewPairs.route, GetOverviewPairs)
  .get(GetOverviewBoostedFeesPools.route, GetOverviewBoostedFeesPools)
  .get(GetOverviewRevenue.route, GetOverviewRevenue)
  .get(GetOverviewTvl.route, GetOverviewTvl)
  .get(GetOverviewVolume.route, GetOverviewVolume)
  .get(GetPairInfoTvl.route, GetPairInfoTvl)
  .get(GetPairInfoVolume.route, GetPairInfoVolume)
  .get(GetPairInfoPools.route, GetPairInfoPools)
  .get(GetPairPriceHistory.route, GetPairPriceHistory)
  .get(GetPoolPriceHistory.route, GetPoolPriceHistory)
  .get(GetPoolLiquidity.route, GetPoolLiquidity)
  .get(GetPoolKey.route, GetPoolKey)
  .get(GetPairLiquidity.route, GetPairLiquidity)
  .get(GetPairTopPositions.route, GetPairTopPositions)
  .get(GetPoolTopPositions.route, GetPoolTopPositions)
  .get(ListPairEvents.route, ListPairEvents)
  .get(BatchListPositionsByAddress.route, BatchListPositionsByAddress)
  .get(ListPositionsByAddress.route, ListPositionsByAddress)
  .get(ListPositionNftEvents.route, ListPositionNftEvents)
  .get(GetPositionNftMetadata.route, GetPositionNftMetadata)
  .get(GetOrderNftImage.route, GetOrderNftImage)
  .get(GetOrderNftMetadata.route, GetOrderNftMetadata)
  .get(GetTwammPoolState.route, GetTwammPoolState)
  .get(GetTwammPoolStateByPoolId.route, GetTwammPoolStateByPoolId)
  .get(GetTwammPairState.route, GetTwammPairState)
  .get(BatchListTwapOrders.route, BatchListTwapOrders)
  .get(ListTwapOrders.route, ListTwapOrders)
  .get(ListLimitOrders.route, ListLimitOrders)
  .get(GetPositionNftImage.route, GetPositionNftImage)
  .get(GetNftMetadata.route, GetNftMetadata)
  .get(GetNftImage.route, GetNftImage)
  .get(ListAuctions.route, ListAuctions)
  .get(GetAuctionNftMetadata.route, GetAuctionNftMetadata)
  .get(GetAuctionNftState.route, GetAuctionNftState)
  .get(GetAuctionNftImage.route, GetAuctionNftImage)
  .get(ListProposals.route, ListProposals)
  .get(ListTopDelegates.route, ListTopDelegates)
  .get(ListVotesOnProposal.route, ListVotesOnProposal)
  .get(ListProposalVoters.route, ListProposalVoters)
  .get(GetStakerInfo.route, GetStakerInfo)
  .get(ListVe33TokensByAddress.route, ListVe33TokensByAddress)
  .get(ListCampaigns.route, ListCampaigns)
  .get(ListRewardsForLocker.route, ListRewardsForLocker)
  .get(ListClaimsForAddress.route, ListClaimsForAddress)
  // catch missed routes
  .all("*", () => error(404));
