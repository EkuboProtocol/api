import { ContractCase, QueryResult, stubQuery, stubTokens } from "../harness";
import {
  CORE_DECIMAL,
  LOGO,
  OWNER,
  tokenRow,
  USDC_DECIMAL,
  WETH_DECIMAL,
} from "../fixtures";
import {
  type LimitOrderMetadata,
  type PositionEventRow,
  type TwammOrderMetadata,
} from "../../queries";

const NFT =
  "0x07b696af58c967c1b14c9dde0ace001720635a660a8e90c565ea459345318b30";
const NFT_DECIMAL = BigInt(NFT).toString();
const POSITIONS =
  "0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067";
const POSITIONS_DECIMAL = BigInt(POSITIONS).toString();
const OWNER_DECIMAL = BigInt(OWNER).toString();
const RECIPIENT_DECIMAL = BigInt(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
).toString();
const TX_HASH = BigInt(
  "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
).toString();
const MINTED_AT = new Date("2024-10-18T12:00:00.000Z");

const tokens = [
  tokenRow({ logo_url: LOGO }),
  tokenRow({
    token_address: WETH_DECIMAL,
    token_symbol: "WETH",
    token_name: "Wrapped Ether",
    token_decimals: 18,
    logo_url: LOGO,
    sort_order: 1,
  }),
];

// Declared with string bounds/tick_spacing/amplification in queries.ts;
// postgres returns the int4/int2 columns as numbers.
const positionMetadata = (
  overrides: Record<string, unknown> = {},
): NonNullable<QueryResult<"getPositionMetadata">> =>
  ({
    minted_tx_hash: TX_HASH,
    minted_timestamp: MINTED_AT,
    positions_address: POSITIONS_DECIMAL,
    salt: "42",
    lower_bound: 19692744,
    upper_bound: 20003808,
    token0: USDC_DECIMAL,
    token1: WETH_DECIMAL,
    fee: "1844674407370955",
    fee_denominator: "18446744073709551616",
    tick_spacing: 5982,
    extension: "0",
    stableswap_center_tick: null,
    stableswap_amplification: null,
    ...overrides,
  }) as unknown as NonNullable<QueryResult<"getPositionMetadata">>;

const stableswapMetadata = positionMetadata({
  lower_bound: -88722835,
  upper_bound: 88722835,
  tick_spacing: null,
  stableswap_center_tick: 19800000,
  stableswap_amplification: 10,
});

const twammOrders: TwammOrderMetadata[] = [
  {
    minted_tx_hash: TX_HASH,
    minted_timestamp: MINTED_AT,
    start_time: new Date("2024-10-18T13:00:00.000Z"),
    end_time: new Date("2024-10-19T13:00:00.000Z"),
    last_update_time: new Date("2024-10-18T14:00:00.000Z"),
    token0: USDC_DECIMAL,
    sale_rate0: "4294967296000",
    token1: WETH_DECIMAL,
    sale_rate1: "0",
    fee: "55340232221128654",
  },
  {
    minted_tx_hash: TX_HASH,
    minted_timestamp: MINTED_AT,
    start_time: new Date("2024-10-18T11:00:00.000Z"),
    end_time: new Date("2024-10-20T13:00:00.000Z"),
    last_update_time: new Date("2024-10-18T14:00:00.000Z"),
    token0: USDC_DECIMAL,
    sale_rate0: "0",
    token1: WETH_DECIMAL,
    sale_rate1: "8589934592",
    fee: "55340232221128654",
  },
];

const limitOrders: LimitOrderMetadata[] = [
  {
    minted_tx_hash: TX_HASH,
    minted_timestamp: MINTED_AT,
    token0: USDC_DECIMAL,
    token1: WETH_DECIMAL,
    tick: 19800064,
    amount: "1000000000",
  },
];

const stubLimitOrderNft = () => {
  stubQuery("getPositionMetadata", null);
  stubQuery("getTwammOrderMetadata", []);
  stubQuery("getLimitOrderMetadata", limitOrders);
  stubTokens(tokens);
};

const classification = {
  is_twamm: false,
  is_oracle: false,
  is_mev_capture: true,
  is_boosted_fees: false,
  is_ve33: false,
};

type PositionsRow = QueryResult<"getPositionsByAddress">["rows"][number];

// The SELECT returns core_address and nft_address but not minted_tx_hash,
// minted_timestamp, salt or fee_denominator, which the declared
// PositionMetadata intersection claims; int4 columns come back as numbers.
const positionsRow = (overrides: Record<string, unknown> = {}): PositionsRow =>
  ({
    chain_id: 1n,
    nft_address: NFT_DECIMAL,
    core_address: CORE_DECIMAL,
    positions_address: POSITIONS_DECIMAL,
    owner: OWNER_DECIMAL,
    token_id: "42",
    token0: USDC_DECIMAL,
    token1: WETH_DECIMAL,
    fee: "1844674407370955",
    tick_spacing: 5982,
    extension: "0",
    lower_bound: 19692744,
    upper_bound: 20003808,
    liquidity: "123456789012",
    total_count: 2,
    pool_state_sqrt_ratio: "1461446703485210103287273052203988822378723970342",
    pool_state_tick: 19800000,
    pool_state_liquidity: "987654321098",
    pool_state_fee: "1844674407370955",
    rewards: { "eth-boost": { amount: "1000", pending: "10" } },
    stableswap_center_tick: null,
    stableswap_amplification: null,
    ...overrides,
  }) as unknown as PositionsRow;

const stubPositionsByAddress = () =>
  stubQuery("getPositionsByAddress", {
    rows: [
      positionsRow(),
      positionsRow({
        token_id: "43",
        owner: null,
        tick_spacing: null,
        lower_bound: -88722835,
        upper_bound: 88722835,
        rewards: null,
        stableswap_center_tick: 19800000,
        stableswap_amplification: 10,
      }),
    ],
    totalCount: 2,
  });

// Declared with a string timestamp in queries.ts; postgres returns
// timestamptz as a Date.
const historyRow = (
  row: Record<string, unknown>,
): QueryResult<"getPositionHistory">[number] =>
  ({
    transaction_hash: TX_HASH,
    timestamp: MINTED_AT,
    block_number: 21000000n,
    from_address: null,
    to_address: null,
    liquidity_delta: null,
    delta0: null,
    delta1: null,
    reward_amount: null,
    ...row,
  }) as unknown as QueryResult<"getPositionHistory">[number];

const eventId = (block: bigint, tx: bigint, event: bigint) =>
  -(1n << 63n) + 1n + (block << 32n) + (tx << 16n) + event;

const eventBase = (tx: number) => ({
  event_id: eventId(21000000n, BigInt(tx), 0n),
  block_number: 21000000n,
  transaction_index: tx,
  event_index: 0,
  transaction_hash: TX_HASH,
  timestamp: MINTED_AT,
  position_id: "42",
  nft_address: NFT_DECIMAL,
  positions_address: POSITIONS_DECIMAL,
});

const noPool = {
  core_address: null,
  pool_id: null,
  token0: null,
  token1: null,
  fee: null,
  fee_denominator: null,
  tick_spacing: null,
  pool_extension: null,
  stableswap_center_tick: null,
  stableswap_amplification: null,
  lower_bound: null,
  upper_bound: null,
  liquidity_delta: null,
  delta0: null,
  delta1: null,
} as const;

const pool = {
  core_address: CORE_DECIMAL,
  pool_id: "1234567890123456789",
  token0: USDC_DECIMAL,
  token1: WETH_DECIMAL,
  fee: "1844674407370955",
  fee_denominator: "18446744073709551616",
  tick_spacing: 5982,
  pool_extension: "0",
  stableswap_center_tick: null,
  stableswap_amplification: null,
  lower_bound: 19692744,
  upper_bound: 20003808,
};

const lifecycle = (type: 0 | 1 | 2, tx: number, from: string, to: string) => ({
  ...eventBase(tx),
  ...noPool,
  type,
  token_id: "42",
  from_address: from,
  to_address: to,
});

const positionEvents: PositionEventRow[] = [
  lifecycle(0, 0, "0", OWNER_DECIMAL),
  {
    ...eventBase(1),
    ...pool,
    tick_spacing: null,
    stableswap_center_tick: 19800000,
    stableswap_amplification: 10,
    type: 3,
    token_id: null,
    from_address: null,
    to_address: null,
    liquidity_delta: "123456789012",
    delta0: "1000000",
    delta1: "400000000000000",
  },
  {
    ...eventBase(2),
    ...pool,
    type: 4,
    token_id: null,
    from_address: null,
    to_address: null,
    liquidity_delta: null,
    delta0: "-500",
    delta1: "198000000000",
  },
  lifecycle(1, 3, OWNER_DECIMAL, RECIPIENT_DECIMAL),
  lifecycle(2, 4, RECIPIENT_DECIMAL, "0"),
  lifecycle(0, 5, "0", OWNER_DECIMAL),
];

export const nftCases: ContractCase[] = [
  {
    operation: "/positions/batch",
    request: `/positions/batch?address=${OWNER}&address=0x1&state=opened&chainId=1&pageSize=2&page=1`,
    stub: stubPositionsByAddress,
  },
  {
    operation: "/positions/{address}",
    request: `/positions/${OWNER}?chainId=1`,
    stub: stubPositionsByAddress,
  },
  {
    operation: "/positions/{chainId}/events",
    request: "/positions/1/events?fromBlock=21000000&limit=5",
    stub: () => stubQuery("listPositionEvents", positionEvents),
  },
  {
    operation: "/positions/{chainId}/{lockerAddress}/{id}/history",
    request: `/positions/1/${POSITIONS}/42/history`,
    stub: () =>
      stubQuery("getPositionHistory", [
        historyRow({
          type: 0,
          from_address: OWNER_DECIMAL,
          to_address: RECIPIENT_DECIMAL,
        }),
        historyRow({
          type: 1,
          liquidity_delta: "-123456789012",
          delta0: "-1000000",
          delta1: "-400000000000000",
        }),
        historyRow({ type: 2, delta0: "500", delta1: "200000000000" }),
        historyRow({ type: 3, reward_amount: "1000000000000000000" }),
      ]),
  },
  {
    operation: "/positions/{chainId}/{nftAddress}/{id}",
    request: `/positions/1/${NFT}/42`,
    stub: () => {
      stubQuery("getPositionMetadata", positionMetadata());
      stubTokens(tokens);
    },
  },
  {
    operation: "/positions/{chainId}/{nftAddress}/{id}",
    name: "/positions/{chainId}/{nftAddress}/{id} (stableswap, unknown tokens)",
    request: `/positions/1/${NFT}/43`,
    stub: () => {
      stubQuery("getPositionMetadata", stableswapMetadata);
      stubTokens([]);
    },
  },
  {
    operation: "/positions/{chainId}/{nftAddress}/{id}/image.svg",
    request: `/positions/1/${NFT}/42/image.svg`,
    contentType: "image/svg+xml",
    stub: () => {
      stubQuery("getPositionMetadata", positionMetadata());
      stubQuery("getPoolClassification", classification);
      stubTokens(tokens);
    },
  },
  {
    operation: "/orders/{chainId}/{nftAddress}/{id}",
    request: `/orders/1/${NFT}/7`,
    stub: () => stubQuery("getTwammOrderMetadata", twammOrders),
  },
  {
    operation: "/orders/{chainId}/{nftAddress}/{id}/image.svg",
    request: `/orders/1/${NFT}/7/image.svg`,
    contentType: "image/svg+xml",
    stub: () => {
      stubQuery("getTwammOrderMetadata", twammOrders);
      stubTokens(tokens);
    },
  },
  {
    operation: "/nft/{chainId}/{nftAddress}/{id}",
    request: `/nft/1/${NFT}/9`,
    contentType: "application/json",
    stub: stubLimitOrderNft,
  },
  {
    operation: "/nft/{chainId}/{nftAddress}/{id}/image.svg",
    request: `/nft/1/${NFT}/9/image.svg`,
    contentType: "image/svg+xml",
    stub: stubLimitOrderNft,
  },
];
