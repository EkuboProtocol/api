import { PlainPool } from "./plainPool";
import { toSqrtRatio } from "../math/tick";

describe("PoolNode", () => {
  describe("findNearestInitializedTickIndex", () => {
    it("no ticks", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(-1);
    });
    it("one tick less than", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [{ tick: -1, liquidityDelta: 1n }],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(0);
    });
    it("one tick equal to", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [{ tick: 0, liquidityDelta: 1n }],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(0);
    });
    it("one tick greater than", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [{ tick: 1, liquidityDelta: 1n }],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(-1);
    });
    it("many ticks", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [
          { tick: -100, liquidityDelta: 0n },
          { tick: -5, liquidityDelta: 0n },
          { tick: -4, liquidityDelta: 0n },
          { tick: 18, liquidityDelta: 0n },
          { tick: 23, liquidityDelta: 0n },
          { tick: 50, liquidityDelta: 0n },
        ],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(-101)).toBe(-1);
      expect(pool.findNearestInitializedTickIndex(-100)).toBe(0);
      expect(pool.findNearestInitializedTickIndex(-99)).toBe(0);
      expect(pool.findNearestInitializedTickIndex(-6)).toBe(0);
      expect(pool.findNearestInitializedTickIndex(-5)).toBe(1);
      expect(pool.findNearestInitializedTickIndex(-4)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(-3)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(0)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(17)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(18)).toBe(3);
      expect(pool.findNearestInitializedTickIndex(19)).toBe(3);
      expect(pool.findNearestInitializedTickIndex(22)).toBe(3);
      expect(pool.findNearestInitializedTickIndex(23)).toBe(4);
      expect(pool.findNearestInitializedTickIndex(24)).toBe(4);
      expect(pool.findNearestInitializedTickIndex(49)).toBe(4);
      expect(pool.findNearestInitializedTickIndex(50)).toBe(5);
      expect(pool.findNearestInitializedTickIndex(51)).toBe(5);
    });
  });

  describe("quote", () => {
    it("works for 0 liquidity 1 token1 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1n,
        isToken1: true,
      });

      expect(calculatedAmount).toEqual(0n);
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.sqrtRatioAfter).toEqual(
        PlainPool.MAX_SQRT_RATIO
      );
    });
    it("works for 0 liquidity 1 token0 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1n,
        isToken1: false,
      });

      expect(calculatedAmount).toEqual(0n);
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.sqrtRatioAfter).toEqual(
        PlainPool.MIN_SQRT_RATIO
      );
    });

    it("works for 10000 liquidity 1000 token1 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [
          { tick: 0, liquidityDelta: 1000000000n },
          { tick: 1, liquidityDelta: -1000000000n },
        ],
        liquidity: 1000000000n,
        sqrtRatio: 1n << 128n,
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1000n,
        isToken1: true,
      });

      expect(calculatedAmount).toEqual(499n);
      expect(executionResources.initializedTicksCrossed).toEqual(1);
      expect(executionResources.sqrtRatioAfter).toEqual(
        PlainPool.MAX_SQRT_RATIO
      );
    });
    it("works for 10000 liquidity 1000 token1 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 1,
        sortedTicks: [
          { tick: 0, liquidityDelta: 1000000000n },
          { tick: 1, liquidityDelta: -1000000000n },
        ],
        liquidity: 0n,
        sqrtRatio: toSqrtRatio(1),
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1000n,
        isToken1: false,
      });

      expect(calculatedAmount).toEqual(499n);
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.sqrtRatioAfter).toEqual(
        PlainPool.MIN_SQRT_RATIO
      );
    });
  });
});
