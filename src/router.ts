import { OpenAPIRouter } from "@cloudflare/itty-router-openapi";
import { version } from "../package.json";
import {
  GetBatchAirdropClaim,
  ListAvailableClaimsForUser,
  ListDrops,
} from "./routes/meta/drops";
import {
  GetDefiSpringIncentives,
  GetDefiSpringIncentivesForAddressAndDates,
  GetDefiSpringIncentivesForTokenId,
} from "./routes/meta/get-defi-spring-incentives";
import { ListTokens } from "./routes/meta/tokens";
import { GetBlock } from "./routes/meta/blocks";
import { GetNetworkStats } from "./routes/meta/stats";
import { GetFees } from "./routes/meta/fees";
import {
  GetLeaderboard,
  GetLeaderboardForCollector,
} from "./routes/leaderboard";
import { GetQuote } from "./routes/quote";
import {
  GetOverview,
  GetOverviewPairs,
  GetOverviewRevenue,
  GetOverviewTvl,
  GetOverviewVolume,
} from "./routes/stats/overview";
import {
  GetPairInfo,
  GetPairInfoPools,
  GetPairInfoTvl,
  GetPairInfoVolume,
  GetPairLiquidity,
  ListPairEvents,
} from "./routes/stats/pair";
import {
  GetPairPrice,
  GetPairPriceHistory,
  GetPairVolatility,
  GetTokenPrices,
} from "./routes/prices";
import {
  GetPoolKeyHash,
  GetPoolLiquidity,
  GetPoolStates,
} from "./routes/state";
import {
  GetNftImage,
  GetNftMetadata,
  GetNftState,
  ListNftEvents,
  ListPositions,
} from "./routes/nft";
import {
  GetTwammPairState,
  GetTwammPoolState,
} from "./routes/twamm/getTwammPoolState";
import { ListTwapOrders } from "./routes/twamm/orders";
import { error } from "itty-router";
import {
  ListProposals,
  GetStakerInfo,
  ListTopDelegates,
  ListVotesOnProposal,
} from "./routes/governance";

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
  .get(ListDrops.route, ListDrops)
  .get(ListAvailableClaimsForUser.route, ListAvailableClaimsForUser)
  .get(GetBatchAirdropClaim.route, GetBatchAirdropClaim)
  .get(GetDefiSpringIncentives.route, GetDefiSpringIncentives)
  .get(
    GetDefiSpringIncentivesForTokenId.route,
    GetDefiSpringIncentivesForTokenId,
  )
  .get(
    GetDefiSpringIncentivesForAddressAndDates.route,
    GetDefiSpringIncentivesForAddressAndDates,
  )
  .get(ListTokens.route, ListTokens)
  .get(GetBlock.route, GetBlock)
  .get(GetNetworkStats.route, GetNetworkStats)
  .get(GetFees.route, GetFees)
  .get(GetLeaderboard.route, GetLeaderboard)
  .get(GetLeaderboardForCollector.route, GetLeaderboardForCollector)
  .get(GetQuote.route, GetQuote)
  .get(GetOverview.route, GetOverview)
  .get(GetOverviewPairs.route, GetOverviewPairs)
  .get(GetOverviewRevenue.route, GetOverviewRevenue)
  .get(GetOverviewTvl.route, GetOverviewTvl)
  .get(GetOverviewVolume.route, GetOverviewVolume)
  .get(GetPairInfo.route, GetPairInfo)
  .get(GetPairInfoTvl.route, GetPairInfoTvl)
  .get(GetPairInfoVolume.route, GetPairInfoVolume)
  .get(GetPairInfoPools.route, GetPairInfoPools)
  .get(GetPairPrice.route, GetPairPrice)
  .get(GetPairVolatility.route, GetPairVolatility)
  .get(GetPairPriceHistory.route, GetPairPriceHistory)
  .get(GetTokenPrices.route, GetTokenPrices)
  .get(GetPoolStates.route, GetPoolStates)
  .get(GetPoolKeyHash.route, GetPoolKeyHash)
  .get(GetPoolLiquidity.route, GetPoolLiquidity)
  .get(ListPositions.route, ListPositions)
  .get(GetPairLiquidity.route, GetPairLiquidity)
  .get(ListPairEvents.route, ListPairEvents)
  .get(GetNftState.route, GetNftState)
  .get(GetNftMetadata.route, GetNftMetadata)
  .get(ListNftEvents.route, ListNftEvents)
  .get(GetNftImage.route, GetNftImage)
  .get(GetTwammPoolState.route, GetTwammPoolState)
  .get(GetTwammPairState.route, GetTwammPairState)
  .get(ListTwapOrders.route, ListTwapOrders)
  .get(ListProposals.route, ListProposals)
  .get(ListTopDelegates.route, ListTopDelegates)
  .get(ListVotesOnProposal.route, ListVotesOnProposal)
  .get(GetStakerInfo.route, GetStakerInfo)
  // catch missed routes
  .all("*", () => error(404));
