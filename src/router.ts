import { fromIttyRouter } from "chanfana";
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
import { GetPoolKeyById, ListPoolKeys } from "./routes/state/poolKeys";
import { error, Router } from "itty-router";
import {
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

const ittyRouter = Router();

export const router = fromIttyRouter(ittyRouter, {
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
    servers: [
      {
        url: "https://prod-api.ekubo.org",
        description: "Production",
      },
    ],
  },
  // removes the redoc and docs urls because they might increase the bundle size/js load time
  redoc_url: null as unknown as undefined,
  docs_url: null as unknown as undefined,
});
router.get(ListTokens.route, ListTokens);
router.get(BatchGetTokens.route, BatchGetTokens);
router.get(GetToken.route, GetToken);
router.get(GetClosestBlock.route, GetClosestBlock);
router.get(GetBlock.route, GetBlock);
router.get(GetCountry.route, GetCountry);
router.get(GetOverviewPairs.route, GetOverviewPairs);
router.get(GetOverviewBoostedFeesPools.route, GetOverviewBoostedFeesPools);
router.get(GetOverviewRevenue.route, GetOverviewRevenue);
router.get(GetOverviewTvl.route, GetOverviewTvl);
router.get(GetOverviewVolume.route, GetOverviewVolume);
router.get(GetPairInfoTvl.route, GetPairInfoTvl);
router.get(GetPairInfoVolume.route, GetPairInfoVolume);
router.get(GetPairInfoPools.route, GetPairInfoPools);
router.get(GetTokenUsdPriceHistory.route, GetTokenUsdPriceHistory);
router.get(GetPairPriceHistory.route, GetPairPriceHistory);
router.get(GetPoolPriceHistory.route, GetPoolPriceHistory);
router.get(GetPoolLiquidity.route, GetPoolLiquidity);
router.get(GetPoolKey.route, GetPoolKey);
router.get(GetPoolKeyById.route, GetPoolKeyById);
router.get(ListPoolKeys.route, ListPoolKeys);
router.get(GetPairLiquidity.route, GetPairLiquidity);
router.get(GetPairTopPositions.route, GetPairTopPositions);
router.get(GetPoolTopPositions.route, GetPoolTopPositions);
router.get(ListPairEvents.route, ListPairEvents);
router.get(BatchListPositionsByAddress.route, BatchListPositionsByAddress);
router.get(ListPositionsByAddress.route, ListPositionsByAddress);
router.get(ListPositionEvents.route, ListPositionEvents);
router.get(ListPositionNftEvents.route, ListPositionNftEvents);
router.get(GetPositionNftMetadata.route, GetPositionNftMetadata);
router.get(GetOrderNftImage.route, GetOrderNftImage);
router.get(GetOrderNftMetadata.route, GetOrderNftMetadata);
router.get(GetTwammPoolState.route, GetTwammPoolState);
router.get(GetTwammPoolStateByPoolId.route, GetTwammPoolStateByPoolId);
router.get(GetTwammPairState.route, GetTwammPairState);
router.get(BatchListTwapOrders.route, BatchListTwapOrders);
router.get(ListTwapOrders.route, ListTwapOrders);
router.get(ListLimitOrders.route, ListLimitOrders);
router.get(GetPositionNftImage.route, GetPositionNftImage);
router.get(GetNftMetadata.route, GetNftMetadata);
router.get(GetNftImage.route, GetNftImage);
router.get(ListAuctions.route, ListAuctions);
router.get(GetAuctionNftMetadata.route, GetAuctionNftMetadata);
router.get(GetAuctionNftState.route, GetAuctionNftState);
router.get(GetAuctionNftImage.route, GetAuctionNftImage);
router.get(ListProposals.route, ListProposals);
router.get(ListTopDelegates.route, ListTopDelegates);
router.get(ListVotesOnProposal.route, ListVotesOnProposal);
router.get(ListProposalVoters.route, ListProposalVoters);
router.get(GetStakerInfo.route, GetStakerInfo);
router.get(ListVe33Pools.route, ListVe33Pools);
router.get(ListVe33Voters.route, ListVe33Voters);
router.get(ListVe33TokensByAddress.route, ListVe33TokensByAddress);
router.get(ListCampaigns.route, ListCampaigns);
router.get(ListRewardsForLocker.route, ListRewardsForLocker);
router.get(ListClaimsForAddress.route, ListClaimsForAddress);
// catch missed routes
router.all("*", () => error(404));
