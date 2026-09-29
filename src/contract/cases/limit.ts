import { ContractCase, QueryResult, stubQuery } from "../harness";
import { OWNER, USDC_DECIMAL, WETH_DECIMAL } from "../fixtures";

type LimitOrderRow = QueryResult<"getLimitOrdersByAddress">["rows"][number];

const limitOrderRow = (
  overrides: Partial<LimitOrderRow> = {},
): LimitOrderRow => ({
  chain_id: 1n,
  token_id: "9",
  token0: USDC_DECIMAL,
  token1: WETH_DECIMAL,
  tick: 19800064,
  liquidity: "123456789",
  amount: "1000000000",
  token0_amount_withdrawn: null,
  token1_amount_withdrawn: null,
  total_count: 3,
  ...overrides,
});

export const limitCases: ContractCase[] = [
  {
    operation: "/limit-orders/orders/{address}",
    request: `/limit-orders/orders/${OWNER}?chainId=1&pageSize=10`,
    stub: () =>
      stubQuery("getLimitOrdersByAddress", {
        rows: [
          limitOrderRow(),
          limitOrderRow({ tick: 19800320, amount: "2000000000" }),
          limitOrderRow({
            token_id: "8",
            tick: 19800192,
            token0_amount_withdrawn: "2500000000",
            token1_amount_withdrawn: "0",
          }),
        ],
        totalCount: 3,
      }),
  },
];
