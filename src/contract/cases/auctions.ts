import { AuctionNftMetadata } from "../../queries";
import { ContractCase, stubQuery, stubTokens } from "../harness";
import { OWNER, pairTokens, USDC_DECIMAL, WETH_DECIMAL } from "../fixtures";

const AUCTIONS = "0x5f6a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2";
const AUCTIONS_DECIMAL = BigInt(AUCTIONS).toString();
const TOKEN_ID = "77";
// Packed auction config: selling flag, start time and duration.
const CONFIG = BigInt(
  "0x0000000001000000000000000000000000000000000067120b000003f480",
).toString();
const OTHER_CONFIG = (BigInt(CONFIG) + 1n).toString();

const auctionRow = (
  overrides: Partial<AuctionNftMetadata> = {},
): AuctionNftMetadata => ({
  minted_tx_hash: BigInt(
    "0x9b1c8e7d6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c",
  ).toString(),
  minted_timestamp: new Date("2024-10-17T09:00:00Z"),
  current_owner: BigInt(OWNER).toString(),
  token0: USDC_DECIMAL,
  token1: WETH_DECIMAL,
  config: CONFIG,
  token0_symbol: "USDC",
  token1_symbol: "WETH",
  total_sale_rate: "4294967296000",
  first_funded_timestamp: new Date("2024-10-17T09:00:00Z"),
  last_funded_timestamp: new Date("2024-10-17T10:00:00Z"),
  fund_add_events: 2,
  participants_count: 5,
  creator_proceeds: "120000000000000000",
  proceeds_collect_events: 1,
  creator_amount: "150000000000000000",
  boost_amount: "30000000000000000",
  completed_timestamp: new Date("2024-10-18T12:00:00Z"),
  boost_rate: "858993459",
  boost_end_time: new Date("2024-10-25T12:00:00Z"),
  ...overrides,
});

// A second, still-running auction key with no symbols, proceeds, completion
// or boost yet.
const openAuctionRow = () =>
  auctionRow({
    current_owner: null,
    config: OTHER_CONFIG,
    token0_symbol: null,
    token1_symbol: null,
    participants_count: 0,
    creator_proceeds: null,
    proceeds_collect_events: null,
    creator_amount: null,
    boost_amount: null,
    completed_timestamp: null,
    boost_rate: null,
    boost_end_time: null,
  });

const stubAuctionNft = () =>
  stubQuery("getAuctionNftMetadata", [auctionRow(), openAuctionRow()]);

const nftPath = `/auctions/1/${AUCTIONS}/${TOKEN_ID}`;

export const auctionsCases: ContractCase[] = [
  {
    operation: "/auctions",
    request: `/auctions?chainId=1&minVisibilityPriority=0&owner=${OWNER}`,
    stub: () =>
      stubQuery("listAuctionsByKey", [
        {
          chain_id: 1n,
          token0: USDC_DECIMAL,
          token1: WETH_DECIMAL,
          config: CONFIG,
          token_id: TOKEN_ID,
          owner: BigInt(OWNER).toString(),
          auctions_contract_address: AUCTIONS_DECIMAL,
          total_sale_rate: "4294967296000",
          completed_timestamp: new Date("2024-10-18T12:00:00Z"),
          boost_end_time: new Date("2024-10-25T12:00:00Z"),
        },
        {
          chain_id: 1n,
          token0: USDC_DECIMAL,
          token1: WETH_DECIMAL,
          config: OTHER_CONFIG,
          token_id: "78",
          owner: BigInt(OWNER).toString(),
          auctions_contract_address: AUCTIONS_DECIMAL,
          total_sale_rate: "1000",
          completed_timestamp: null,
          boost_end_time: null,
        },
      ]),
  },
  {
    operation: "/auctions/{chainId}/{nftAddress}/{id}",
    request: nftPath,
    stub: stubAuctionNft,
  },
  {
    operation: "/auctions/{chainId}/{nftAddress}/{id}/state",
    request: `${nftPath}/state`,
    stub: stubAuctionNft,
  },
  {
    operation: "/auctions/{chainId}/{nftAddress}/{id}/image.svg",
    request: `${nftPath}/image.svg`,
    contentType: "image/svg+xml",
    stub: () => {
      stubAuctionNft();
      stubTokens(pairTokens);
    },
  },
];
