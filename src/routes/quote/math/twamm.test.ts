import { describe, expect, it } from "vitest";
import { calculateNextSqrtRatio, exp, sqrt } from "./twamm";

const TEST_CASES: {
  description?: string;
  sqrtRatio: bigint;
  liquidity: bigint;
  token0SaleRate: bigint;
  token1SaleRate: bigint;
  timeElapsed: bigint;
  fee: bigint;
}[] = [
  {
    description: "liquidity is zero, price is sqrtSaleRatio",
    sqrtRatio: 0n,
    liquidity: 0n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 0n,
    fee: 0n,
  },
  {
    description: "large exponent (> 88), price is sqrtSaleRatio",
    sqrtRatio: 1n << 128n,
    liquidity: 1n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (1980n * 10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
  },
  {
    description: "low liquidity, same sale rate",
    sqrtRatio: 2n << 128n,
    liquidity: 1n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
  },
  {
    description: "low liquidity, token0SaleRate > token1SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1n,
    token0SaleRate: (2n * 10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 16n,
    fee: 0n,
  },
  {
    description: "low liquidity, token1SaleRate > token0SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (2n * 10n ** 18n) << 32n,
    timeElapsed: 16n,
    fee: 0n,
  },
  {
    description: "high liquidity, same sale rate",
    sqrtRatio: 2n << 128n,
    liquidity: 1_000_000n * 10n ** 18n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
  },
  {
    description: "high liquidity, token0SaleRate > token1SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1_000_000n * 10n ** 18n,
    token0SaleRate: (2n * 10n ** 18n) << 32n,
    token1SaleRate: (10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
  },
  {
    description: "high liquidity, token1SaleRate > token0SaleRate",
    sqrtRatio: 1n << 128n,
    liquidity: 1_000_000n * 10n ** 18n,
    token0SaleRate: (10n ** 18n) << 32n,
    token1SaleRate: (2n * 10n ** 18n) << 32n,
    timeElapsed: 1n,
    fee: 0n,
  },
  {
    description: "round in direction of price",
    sqrtRatio: 481231811499356508086519009265716982182n,
    liquidity: 70710696755630728101718334n,
    token0SaleRate: 10526880627450980392156862745n,
    token1SaleRate: 10526880627450980392156862745n,
    timeElapsed: 2040n,
    fee: 0n,
  },
];

describe(calculateNextSqrtRatio, () => {
  describe("many such cases", () => {
    for (const testCase of TEST_CASES) {
      it(testCase.description || "test case", () => {
        expect(
          calculateNextSqrtRatio(
            testCase.sqrtRatio,
            testCase.liquidity,
            testCase.token0SaleRate,
            testCase.token1SaleRate,
            testCase.timeElapsed,
            testCase.fee,
          ),
        ).toMatchSnapshot();
      });
    }
  });
});

describe(exp, () => {
  const cases = [
    0x1n,
    0x10n,
    0x100n,
    0x1000n,
    0x10000n,
    0x100000n,
    0x1000000n,
    0x10000000n,
    0x100000000n,
    0x20000000000000000n,
    1n << 64n,
    88n << 64n,
  ];

  for (const num of cases) {
    it(`test ${num}`, () => {
      expect(exp(num)).toMatchSnapshot();
    });
  }
});

describe(sqrt, () => {
  const cases = [2n, 1n << 32n, 1n << 64n, (10n ** 18n) << 32n];

  for (const num of cases) {
    it(`test ${num}`, () => {
      expect(sqrt(num)).toMatchSnapshot();
    });
  }
});
