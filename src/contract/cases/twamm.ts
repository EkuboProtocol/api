import { ContractCase, QueryResult, stubQuery, stubTokens } from "../harness";
import {
  CORE,
  OWNER,
  pairTokens,
  USDC,
  USDC_DECIMAL,
  WETH,
  WETH_DECIMAL,
} from "../fixtures";

const TWAMM_FEE = "9223372036854775";
const POOL_ID =
  "0x3a3d2a2b0e1d6f4c5b8a7e9d0c1b2a39485766f5e4d3c2b1a0918273645f6e7d";

const poolState = (
  token0SaleRate: string,
  token1SaleRate: string,
  lastExecution: string,
): QueryResult<"getTwammPoolStateByKey">[number] => ({
  token0_sale_rate: token0SaleRate,
  token1_sale_rate: token1SaleRate,
  last_execution_time: new Date(lastExecution),
});

const delta = (
  time: string,
  delta0: string,
  delta1: string,
): QueryResult<"getSaleRateDeltasByKey">[number] => ({
  time: new Date(time),
  net_sale_rate_delta0: delta0,
  net_sale_rate_delta1: delta1,
});

// Orders that start in the future only add sale rate. Every order also ends,
// which subtracts its sale rate; those negative deltas are the known-drift cases.
const startingDeltas = [
  delta("2024-10-19T00:00:00Z", "1500000000", "0"),
  delta("2024-10-20T00:00:00Z", "0", "250000000000"),
];
const endingDeltas = [
  ...startingDeltas,
  delta("2024-10-21T00:00:00Z", "-2500000000", "-650000000000"),
];

const stubPool = (
  deltas: QueryResult<"getSaleRateDeltasByKey">[number][],
  withTokens: boolean,
) => {
  if (withTokens) stubTokens(pairTokens);
  stubQuery("getTwammPoolStateByKey", [
    poolState("1000000000", "400000000000", "2024-10-18T12:00:00Z"),
  ]);
  stubQuery("getSaleRateDeltasByKey", deltas);
};

const stubPair = (deltas: QueryResult<"getSaleRateDeltasByKey">[number][]) => {
  stubTokens(pairTokens);
  stubQuery("getTwammPoolStateByKey", [
    poolState("1000000000", "0", "2024-10-18T12:00:00Z"),
    poolState("0", "400000000000", "2024-10-18T12:00:00Z"),
    // Idle pools are filtered out of the pair response.
    poolState("0", "0", "2024-10-01T00:00:00Z"),
  ]);
  stubQuery("getSaleRateDeltasByKey", deltas);
};

const POOL_BY_KEY =
  "/twap/pools/{chainId}/{coreAddress}/{tokenA}/{tokenB}/{fee}";
const POOL_BY_ID = "/twap/pools/{chainId}/{coreAddress}/{poolId}";
const PAIR = "/twap/pair/{chainId}/{tokenA}/{tokenB}";
const poolByKeyRequest = `/twap/pools/1/${CORE}/${WETH}/${USDC}/${TWAMM_FEE}`;
const poolByIdRequest = `/twap/pools/1/${CORE}/${POOL_ID}`;
const pairRequest = `/twap/pair/1/${WETH}/${USDC}`;

const ORDER_NFT = "0x66e4c1e9a2cd0e9c2d4a6b4c0e1d7e3c2b8e9f10";

type OrderRows = Exclude<
  QueryResult<"getTwammOrdersByAddress">["rows"],
  never[]
>;

const orderRows: OrderRows[number][] = [
  {
    chain_id: 1n,
    nft_address: BigInt(ORDER_NFT).toString(),
    token_id: "4242",
    total_count: 3,
    // jsonb: timestamps arrive as ISO strings, last_collect_proceeds is the
    // ::TEXT rendering of a timestamptz.
    orders: [
      {
        sell_token: USDC_DECIMAL,
        buy_token: WETH_DECIMAL,
        fee: TWAMM_FEE,
        start_time: "2024-10-18T00:00:00+00:00",
        end_time: "2024-10-21T00:00:00+00:00",
        total_proceeds_withdrawn: "120000000000000000",
        total_amount_sold: "300000000",
        sale_rate: "1000000000",
        last_collect_proceeds: "2024-10-18 12:00:00+00",
      },
      {
        sell_token: WETH_DECIMAL,
        buy_token: USDC_DECIMAL,
        fee: TWAMM_FEE,
        start_time: "2024-10-19T00:00:00+00:00",
        end_time: "2024-10-22T00:00:00+00:00",
        total_proceeds_withdrawn: "0",
        total_amount_sold: "0",
        sale_rate: "250000000000",
        last_collect_proceeds: null,
      },
    ],
  },
];

const stubOrders = () =>
  stubQuery("getTwammOrdersByAddress", {
    rows: orderRows as unknown as OrderRows,
    totalCount: 3,
  });

export const twammCases: ContractCase[] = [
  {
    operation: POOL_BY_KEY,
    request: poolByKeyRequest,
    name: `${poolByKeyRequest} (starting orders)`,
    stub: () => stubPool(startingDeltas, true),
  },
  {
    operation: POOL_BY_KEY,
    request: poolByKeyRequest,
    name: `${poolByKeyRequest} (ending orders)`,
    stub: () => stubPool(endingDeltas, true),
  },
  {
    operation: POOL_BY_ID,
    request: poolByIdRequest,
    name: `${poolByIdRequest} (starting orders)`,
    stub: () => stubPool(startingDeltas, false),
  },
  {
    operation: POOL_BY_ID,
    request: poolByIdRequest,
    name: `${poolByIdRequest} (ending orders)`,
    stub: () => stubPool(endingDeltas, false),
  },
  {
    operation: PAIR,
    request: pairRequest,
    name: `${pairRequest} (starting orders)`,
    stub: () => stubPair(startingDeltas),
  },
  {
    operation: PAIR,
    request: pairRequest,
    name: `${pairRequest} (ending orders)`,
    stub: () => stubPair(endingDeltas),
  },
  {
    operation: "/twap/orders/{address}",
    request: `/twap/orders/${OWNER}?state=opened&chainId=1&pageSize=2&page=1`,
    stub: stubOrders,
  },
  {
    operation: "/twap/orders/batch",
    request: `/twap/orders/batch?address=${OWNER}&address=${CORE}&pageSize=2`,
    stub: stubOrders,
  },
];
