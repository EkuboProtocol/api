import { describe, expect, test } from "bun:test";
import {
  projectNextDayReward,
  type ProjectionCampaign,
  type ProjectionPair,
  type ProjectionPosition,
} from "./projection";

// Starknet mainnet values from prod-api.ekubo.org on 2026-10-12: the
// btcfi_season WBTC/strkBTC pair from /campaigns, and position 2288759
// (0x22ec77) from /positions/{owner} with its pool's current tick.
const NOW = new Date("2026-10-12T12:00:00Z");
const CHAIN = 0x534e5f4d41494en;
const CORE = 0x5dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4bn;
const LOCKER =
  0x2e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067n;
const WBTC = 0x3fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7acn;
const STRKBTC =
  0x787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135n;

const campaign: ProjectionCampaign = {
  chainId: CHAIN,
  coreAddress: CORE,
  allowedLockers: null,
  allowedExtensions: [
    0n,
    0x43e4f09c32d13d43a880e85f69f7de93ceda62d6cf2581a582c6db635548fdcn,
  ],
  startTime: new Date("2025-10-02T00:00:00Z"),
  endTime: null,
};

const pair: ProjectionPair = {
  token0: WBTC,
  token1: STRKBTC,
  depthPercent: 0.0018702171722386758,
  depth0: 3923441287n,
  depth1: 1320666381n,
  dailyRewardsToken0: 3333270000000000000000n,
  dailyRewardsToken1: 3333270000000000000000n,
};

const position: ProjectionPosition = {
  chainId: CHAIN,
  coreAddress: CORE,
  locker: LOCKER,
  token0: WBTC,
  token1: STRKBTC,
  extension: 0n,
  // 0.01%
  fee: 0x68db8bac710cb4000000000000000n,
  feeDenominator: 1n << 128n,
  tickLower: 0,
  tickUpper: 800,
  liquidity: 1998391686347n,
  includedInDepth: true,
};

const TICK = -639;

describe("projectNextDayReward", () => {
  test("reference fixture: the reported position", () => {
    const projection = projectNextDayReward(
      campaign,
      pair,
      position,
      TICK,
      NOW,
    );
    if (projection.status !== "estimated") throw new Error(projection.status);
    // The whole range is above the price and inside the 1,868-tick band, so
    // all of its 7.99 WBTC counts against the pair's 39.23 WBTC above-price
    // depth: 20.37% of the 3,333.27 STRK token0 budget.
    expect(projection.share0).toBeCloseTo(799196424 / 3923441287, 6);
    expect(projection.share1).toBe(0);
    expect(Number(projection.amount) / 1e18).toBeCloseTo(678.99, 1);
  });

  test("a hypothetical deposit is added to the depth it competes with", () => {
    const projection = projectNextDayReward(
      campaign,
      pair,
      { ...position, includedInDepth: false },
      TICK,
      NOW,
    );
    if (projection.status !== "estimated") throw new Error(projection.status);
    expect(projection.share0).toBeCloseTo(
      799196424 / (3923441287 + 799196424),
      6,
    );
  });

  test("liquidity inside the fee distance or beyond the band earns nothing", () => {
    // Fee distance is 100 ticks and the band 1,868: [-639, -539) is too
    // close, [1229, 5000) too far.
    for (const [tickLower, tickUpper] of [
      [-639, -539],
      [1229, 5000],
    ]) {
      expect(
        projectNextDayReward(
          campaign,
          pair,
          { ...position, tickLower, tickUpper },
          TICK,
          NOW,
        ),
      ).toMatchObject({ status: "estimated", amount: 0n });
    }
  });

  test("a range around the price earns from both budgets", () => {
    const projection = projectNextDayReward(
      campaign,
      pair,
      { ...position, tickLower: -2000, tickUpper: 800 },
      TICK,
      NOW,
    );
    if (projection.status !== "estimated") throw new Error(projection.status);
    expect(projection.share0).toBeGreaterThan(0);
    expect(projection.share1).toBeGreaterThan(0);
  });

  test("ineligible positions are reported, not estimated as zero", () => {
    const cases: [Partial<ProjectionPosition>, string][] = [
      [{ chainId: 1n }, "another chain"],
      [{ coreAddress: 1n }, "another core"],
      [{ extension: 7n }, "extension not allowed"],
      [{ token1: 1n }, "another pair"],
    ];
    for (const [override, reason] of cases)
      expect(
        projectNextDayReward(
          campaign,
          pair,
          { ...position, ...override },
          TICK,
          NOW,
        ),
      ).toEqual({ status: "ineligible", reason });
    expect(
      projectNextDayReward(
        { ...campaign, endTime: new Date("2026-10-01T00:00:00Z") },
        pair,
        position,
        TICK,
        NOW,
      ),
    ).toEqual({ status: "ineligible", reason: "ended" });
    expect(
      projectNextDayReward(
        { ...campaign, allowedLockers: [1n] },
        pair,
        position,
        TICK,
        NOW,
      ),
    ).toEqual({ status: "ineligible", reason: "locker not allowed" });
  });

  test("cases the depth data cannot answer are unsupported or unknown", () => {
    expect(
      projectNextDayReward(
        { ...campaign, endTime: new Date("2026-10-13T00:00:00Z") },
        pair,
        position,
        TICK,
        NOW,
      ),
    ).toEqual({
      status: "unsupported",
      reason: "campaign ends within the next 24 hours",
    });
    expect(
      projectNextDayReward(
        { ...campaign, allowedLockers: [LOCKER] },
        pair,
        position,
        TICK,
        NOW,
      ),
    ).toEqual({ status: "unsupported", reason: "campaign restricts lockers" });
    expect(
      projectNextDayReward(
        campaign,
        { ...pair, depthPercent: null, depth0: null, depth1: null },
        position,
        TICK,
        NOW,
      ),
    ).toEqual({ status: "unknown", reason: "no depth for the pair" });
    expect(
      projectNextDayReward(
        campaign,
        pair,
        { ...position, fee: 1n << 125n },
        TICK,
        NOW,
      ),
    ).toEqual({
      status: "unsupported",
      reason: "pool fee is wider than the depth band",
    });
  });
});
