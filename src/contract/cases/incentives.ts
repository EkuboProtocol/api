import { ContractCase, QueryResult, stubQuery } from "../harness";
import { CORE_DECIMAL, OWNER, USDC_DECIMAL, WETH_DECIMAL } from "../fixtures";

type CampaignRow = QueryResult<"listCampaigns">[number];

const LOCKER =
  "0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067";
const EXTENSION_DECIMAL = "0";
const DROP_DECIMAL = BigInt(
  "0x7777777777777777777777777777777777777777",
).toString();
const ROOT_DECIMAL = BigInt(
  "0x0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
).toString();

const campaignRow = (overrides: Partial<CampaignRow> = {}): CampaignRow => ({
  chain_id: 1n,
  core_address: CORE_DECIMAL,
  allowed_lockers: [BigInt(LOCKER).toString()],
  start_time: new Date("2026-09-01T00:00:00.000Z"),
  end_time: new Date("2026-12-01T00:00:00.000Z"),
  name: "USDC/WETH liquidity",
  slug: "usdc-weth",
  reward_token: USDC_DECIMAL,
  next_drop_time: new Date("2026-09-30T12:00:00.000Z"),
  allowed_extensions: [EXTENSION_DECIMAL],
  rewards: [
    {
      token0: USDC_DECIMAL,
      token1: WETH_DECIMAL,
      depth_percent: 0.02,
      depth0: "100000",
      depth1: "40000000000000000",
      distributed: "1000000",
      scheduled: "9000000",
      daily_rewards: "100000",
      daily_rewards_token0: "60000",
      daily_rewards_token1: "40000",
      realized_volatility: 0.015,
    },
    {
      token0: USDC_DECIMAL,
      token1: WETH_DECIMAL,
      depth_percent: null,
      depth0: null,
      depth1: null,
      distributed: "0",
      scheduled: "9000000",
      daily_rewards: "0",
      daily_rewards_token0: "0",
      daily_rewards_token1: "0",
      // Declared as number in queries.ts; the view's AVG over the last day's
      // periods is NULL when none fall in that window.
      realized_volatility: null as unknown as number,
    },
  ],
  ...overrides,
});

export const incentivesCases: ContractCase[] = [
  {
    operation: "/campaigns",
    request: "/campaigns?chainId=1",
    stub: () =>
      stubQuery("listCampaigns", [
        campaignRow(),
        campaignRow({
          slug: "open-ended",
          allowed_lockers: null,
          end_time: null,
        }),
      ]),
  },
  {
    // The view's next_drop_time CASE has no ELSE branch, so a campaign whose
    // end_time has passed yields NULL; the schema says it is never null.
    name: "/campaigns ended campaign",
    knownDrift:
      "nextDropTime is null once a campaign has ended; the schema says non-null.",
    operation: "/campaigns",
    request: "/campaigns",
    stub: () =>
      stubQuery("listCampaigns", [
        campaignRow({
          slug: "ended",
          start_time: new Date("2026-01-01T00:00:00.000Z"),
          end_time: new Date("2026-03-01T00:00:00.000Z"),
          // Declared as Date in queries.ts; NULL once the campaign has ended.
          next_drop_time: null as unknown as Date,
        }),
      ]),
  },
  {
    operation: "/rewards/{chainId}/{locker}/{salt}",
    request: `/rewards/1/${LOCKER}/42?startTime=2026-09-01T00:00:00Z&endTime=2026-09-29T00:00:00Z`,
    stub: () =>
      stubQuery("listComputedRewardsForPosition", [
        { slug: "usdc-weth", amount: "1500000", pending: "500000" },
        { slug: "open-ended", amount: "20000", pending: "0" },
      ]),
  },
  {
    operation: "/claims/{address}",
    request: `/claims/${OWNER}?chainId=1`,
    stub: () =>
      stubQuery("listAvailableClaimsForAddress", [
        {
          slug: "usdc-weth",
          chain_id: 1n,
          drop_address: DROP_DECIMAL,
          owner: BigInt(OWNER).toString(),
          token: USDC_DECIMAL,
          root: ROOT_DECIMAL,
          index: 12,
          address: BigInt(OWNER).toString(),
          amount: "1500000",
          proof: [ROOT_DECIMAL, "12345"],
        },
        {
          slug: null,
          chain_id: 1n,
          drop_address: DROP_DECIMAL,
          // Declared as string in queries.ts; owner comes from a LEFT JOIN on
          // the funded root and is NULL for drops that were never funded.
          owner: null as unknown as string,
          token: USDC_DECIMAL,
          root: ROOT_DECIMAL,
          index: 3,
          address: BigInt(OWNER).toString(),
          amount: "20000",
          proof: [],
        },
      ]),
  },
];
