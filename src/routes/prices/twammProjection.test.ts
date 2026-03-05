import { describe, expect, it } from "bun:test";
import {
  EVM_MAX_SQRT_RATIO,
  EVM_MIN_SQRT_RATIO,
  STARKNET_MAX_SQRT_RATIO,
  STARKNET_MIN_SQRT_RATIO,
  toSqrtRatio,
} from "@ekubo/sdk";
import { projectTwammPoolStateAtTime } from "./twammProjection";

type ChainKind = "evm" | "starknet";

const STARKNET_MAINNET_CHAIN_ID = 0x534e5f4d41494en;
const EVM_MAINNET_CHAIN_ID = 1n;
const MAX_BOUND_USABLE_TICK_MAGNITUDE = 88368108;

interface Tick {
  tick: number;
  liquidityDelta: bigint;
}

interface TwammSaleRateDelta {
  saleRateDelta0: bigint;
  saleRateDelta1: bigint;
  time: number;
}

interface PoolSeed {
  token0: bigint;
  token1: bigint;
  fee: bigint;
  extension: bigint;
  sqrtRatio: bigint;
  liquidity: bigint;
  tick: number;
  token0SaleRate: bigint;
  token1SaleRate: bigint;
  lastExecutionTime: number;
  sortedTicks: Tick[];
  saleRateDeltas: TwammSaleRateDelta[];
}

interface ProjectionScenario {
  name: string;
  targets: number[];
  pool: (chain: ChainKind) => PoolSeed;
}

function toSortedTicks(liquidity: bigint): Tick[] {
  return [
    {
      tick: -MAX_BOUND_USABLE_TICK_MAGNITUDE,
      liquidityDelta: liquidity,
    },
    {
      tick: MAX_BOUND_USABLE_TICK_MAGNITUDE,
      liquidityDelta: -liquidity,
    },
  ];
}

function minSqrtRatioForChain(chain: ChainKind): bigint {
  return chain === "evm" ? EVM_MIN_SQRT_RATIO : STARKNET_MIN_SQRT_RATIO;
}

function maxSqrtRatioForChain(chain: ChainKind): bigint {
  return chain === "evm" ? EVM_MAX_SQRT_RATIO : STARKNET_MAX_SQRT_RATIO;
}

function chainIdFor(chain: ChainKind): bigint {
  return chain === "evm" ? EVM_MAINNET_CHAIN_ID : STARKNET_MAINNET_CHAIN_ID;
}

function normalizeStateForSnapshot(
  state: ReturnType<typeof projectTwammPoolStateAtTime>,
) {
  return {
    sqrtRatio: state.sqrtRatio.toString(),
    liquidity: state.liquidity.toString(),
    activeTickIndex: state.activeTickIndex,
    token0SaleRate: state.token0SaleRate.toString(),
    token1SaleRate: state.token1SaleRate.toString(),
    lastExecutionTime: state.lastExecutionTime,
  };
}

function expectProjectedStateSnapshot(
  chain: ChainKind,
  pool: PoolSeed,
  targetTime: number,
) {
  const projected = projectTwammPoolStateAtTime({
    chainId: chainIdFor(chain),
    token0: pool.token0,
    token1: pool.token1,
    fee: pool.fee,
    sqrtRatio: pool.sqrtRatio,
    liquidity: pool.liquidity,
    tick: pool.tick,
    token0SaleRate: pool.token0SaleRate,
    token1SaleRate: pool.token1SaleRate,
    lastExecutionTime: pool.lastExecutionTime,
    sortedTicks: pool.sortedTicks,
    saleRateDeltas: pool.saleRateDeltas,
    targetTime,
  });

  expect(normalizeStateForSnapshot(projected)).toMatchSnapshot();
}

const SCENARIOS: ProjectionScenario[] = [
  {
    name: "zero sale rates",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(1, chain),
      liquidity: 1_000_000_000n,
      tick: 0,
      token0SaleRate: 0n,
      token1SaleRate: 0n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(1_000_000_000n),
    }),
  },
  {
    name: "one-sided sale rates from token1",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(1, chain),
      liquidity: 1_000_000n,
      tick: 0,
      token0SaleRate: 0n,
      token1SaleRate: 1n << 32n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(1_000_000n),
    }),
  },
  {
    name: "one-sided sale rates from token0",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(1, chain),
      liquidity: 1_000_000n,
      tick: 0,
      token0SaleRate: 1n << 32n,
      token1SaleRate: 0n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(1_000_000n),
    }),
  },
  {
    name: "at max sqrt ratio",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: maxSqrtRatioForChain(chain),
      liquidity: 1_000_000n,
      tick: 0,
      token0SaleRate: 0n,
      token1SaleRate: 1n << 32n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(1_000_000n),
    }),
  },
  {
    name: "at min sqrt ratio",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: minSqrtRatioForChain(chain),
      liquidity: 1_000_000n,
      tick: 0,
      token0SaleRate: 1n << 32n,
      token1SaleRate: 0n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(1_000_000n),
    }),
  },
  {
    name: "close to max usable price",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(MAX_BOUND_USABLE_TICK_MAGNITUDE, chain) - 1n,
      liquidity: 1_000_000n,
      tick: 0,
      token0SaleRate: 0n,
      token1SaleRate: 1n << 32n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(1_000_000n),
    }),
  },
  {
    name: "close to min usable price",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(-MAX_BOUND_USABLE_TICK_MAGNITUDE, chain),
      liquidity: 1_000_000n,
      tick: -MAX_BOUND_USABLE_TICK_MAGNITUDE,
      token0SaleRate: 1n << 32n,
      token1SaleRate: 0n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(1_000_000n),
    }),
  },
  {
    name: "sale rate deltas move away from edge halfway through",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(MAX_BOUND_USABLE_TICK_MAGNITUDE, chain) - 1n,
      liquidity: 1_000_000n,
      tick: 0,
      token0SaleRate: 0n,
      token1SaleRate: 1n << 32n,
      lastExecutionTime: 0,
      saleRateDeltas: [
        {
          saleRateDelta0: 100_000n * (1n << 32n),
          saleRateDelta1: 0n,
          time: 16,
        },
      ],
      sortedTicks: toSortedTicks(1_000_000n),
    }),
  },
  {
    name: "sale rate deltas go to zero halfway through",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(1, chain),
      liquidity: 100_000n,
      tick: 0,
      token0SaleRate: 1n << 32n,
      token1SaleRate: 1n << 32n,
      lastExecutionTime: 0,
      saleRateDeltas: [
        {
          saleRateDelta0: -(1n << 32n),
          saleRateDelta1: -(1n << 32n),
          time: 16,
        },
      ],
      sortedTicks: toSortedTicks(100_000n),
    }),
  },
  {
    name: "sale rate deltas double halfway through",
    targets: [32],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(1, chain),
      liquidity: 100_000n,
      tick: 0,
      token0SaleRate: 1n << 32n,
      token1SaleRate: 1n << 32n,
      lastExecutionTime: 0,
      saleRateDeltas: [
        {
          saleRateDelta0: 1n << 32n,
          saleRateDelta1: 1n << 32n,
          time: 16,
        },
      ],
      sortedTicks: toSortedTicks(100_000n),
    }),
  },
  {
    name: "price-after-no-swap examples",
    targets: [43_200, 86_400],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(693_147, chain),
      liquidity: 70_710_696_755_630_728_101_718_334n,
      tick: 693_147,
      token0SaleRate: 10_526_880_627_450_980_392_156_862_745n,
      token1SaleRate: 10_526_880_627_450_980_392_156_862_745n,
      lastExecutionTime: 0,
      saleRateDeltas: [],
      sortedTicks: toSortedTicks(70_710_696_755_630_728_101_718_334n),
    }),
  },
  {
    name: "moody examples",
    targets: [60, 90, 120],
    pool: (chain) => ({
      token0: 0n,
      token1: 1n,
      fee: 0n,
      extension: 1n,
      sqrtRatio: toSqrtRatio(693_147, chain),
      liquidity: 10n ** 21n,
      tick: 693_147,
      token0SaleRate: (10n ** 18n) << 32n,
      token1SaleRate: (10n ** 18n) << 32n,
      lastExecutionTime: 60,
      saleRateDeltas: [
        {
          time: 120,
          saleRateDelta0: -((10n ** 18n) << 32n),
          saleRateDelta1: -((10n ** 18n) << 32n),
        },
      ],
      sortedTicks: toSortedTicks(10n ** 21n),
    }),
  },
];

describe("projectTwammPoolStateAtTime regression", () => {
  for (const chain of ["evm", "starknet"] as const) {
    describe(chain, () => {
      for (const scenario of SCENARIOS) {
        for (const target of scenario.targets) {
          it(`${scenario.name} at t=${target}`, () => {
            expectProjectedStateSnapshot(chain, scenario.pool(chain), target);
          });
        }
      }
    });
  }

  it("throws when target time is before last execution", () => {
    expect(() =>
      projectTwammPoolStateAtTime({
        chainId: EVM_MAINNET_CHAIN_ID,
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1, "evm"),
        liquidity: 100n,
        tick: 0,
        token0SaleRate: 1n,
        token1SaleRate: 1n,
        lastExecutionTime: 10,
        sortedTicks: toSortedTicks(100n),
        saleRateDeltas: [],
        targetTime: 9,
      }),
    ).toThrow("Last execution time exceeds target time");
  });
});
