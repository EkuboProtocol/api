import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from "../math/tick";
import { MAX_BOUND_USABLE_TICK_MAGNITUDE, TwammPool } from "./twammPool";

import { describe, expect, it } from "vitest";

describe("TWAMMPoolNode", () => {
  describe("quote", () => {
    it("zero sale rates, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 1000000000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rates, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token0, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token1, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token0, max price, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: MAX_SQRT_RATIO,
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token1, min price, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: MIN_SQRT_RATIO,
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token0, close to max usable price, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(MAX_BOUND_USABLE_TICK_MAGNITUDE) - 1n,
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(1);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token0, close to max usable price, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(MAX_BOUND_USABLE_TICK_MAGNITUDE) - 1n,
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token1, close to min usable price, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(-MAX_BOUND_USABLE_TICK_MAGNITUDE),
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(1);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token1, close to min usable price, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(-MAX_BOUND_USABLE_TICK_MAGNITUDE),
        liquidity: 1_000_000n,
        tick: -MAX_BOUND_USABLE_TICK_MAGNITUDE,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token1, close to min usable price, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(-MAX_BOUND_USABLE_TICK_MAGNITUDE),
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(1);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("zero sale rate token0, close to max usable price, deltas move to usable price, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(MAX_BOUND_USABLE_TICK_MAGNITUDE) - 1n,
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [
          {
            saleRateDelta0: 100000n * (1n << 32n),
            saleRateDelta1: 0n,
            time: 16,
          },
        ],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(1);
    });

    it("zero sale rate token1, close to min usable price, deltas move to usable price, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(-MAX_BOUND_USABLE_TICK_MAGNITUDE),
        liquidity: 1_000_000n,
        tick: -MAX_BOUND_USABLE_TICK_MAGNITUDE,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [
          {
            saleRateDelta0: 0n,
            saleRateDelta1: 100000n * (1n << 32n),
            time: 16,
          },
        ],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      // swapping in token1 so the price goes back up across the min tick
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(1);
    });

    it("zero sale rate token0, close to max usable price, deltas move to usable price, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(MAX_BOUND_USABLE_TICK_MAGNITUDE) - 1n,
        liquidity: 1_000_000n,
        tick: MAX_BOUND_USABLE_TICK_MAGNITUDE - 1,
        extension: 1n,
        token0SaleRate: 0n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [
          {
            saleRateDelta0: 100000n * (1n << 32n),
            saleRateDelta1: 0n,
            time: 16,
          },
        ],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      // swapping in token0 so the price goes back down across the max usable tick
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(1);
    });

    it("zero sale rate token1, close to min usable price, deltas move to usable price, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(-MAX_BOUND_USABLE_TICK_MAGNITUDE),
        liquidity: 1_000_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 0n,
        lastExecutionTime: 0,
        saleRateDeltas: [
          {
            saleRateDelta0: 0n,
            saleRateDelta1: 100000n * (1n << 32n),
            time: 16,
          },
        ],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(1);
    });

    it("1e18 sale rates, no sale rate deltas, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("1e18 sale rates, no sale rate deltas, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("token0SaleRate > token1SaleRate, no sale rate deltas, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 1_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 10n << 32n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("token1SaleRate > token0SaleRate, no sale rate deltas, quote token1", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 10n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("token0SaleRate > token1SaleRate, no sale rate deltas, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 10n << 32n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("token1SaleRate > token0SaleRate, no sale rate deltas, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 10n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(0);
    });

    it("sale rate deltas goes to zero halfway through execution, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
        token0SaleRate: 1n << 32n,
        token1SaleRate: 1n << 32n,
        lastExecutionTime: 0,
        saleRateDeltas: [
          {
            saleRateDelta0: -1n << 32n,
            saleRateDelta1: -1n << 32n,
            time: 16,
          },
        ],
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(1);
    });

    it("sale rate deltas doubles halfway through execution, quote token0", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 100_000n,
        tick: 0,
        extension: 1n,
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
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.virtualOrderSecondsExecuted).toEqual(32);
      expect(executionResources.virtualOrderDeltaTimesCrossed).toEqual(1);
    });

    it("price after no swap", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(693147),
        liquidity: 70710696755630728101718334n,
        tick: 693147,
        extension: 1n,
        token0SaleRate: 10526880627450980392156862745n,
        token1SaleRate: 10526880627450980392156862745n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const first = pool.quote({
        tokenAmount: {
          amount: 0n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 43200 } },
      });
      expect(first).toMatchSnapshot("result of quote after half day");

      expect(
        pool.quote({
          tokenAmount: {
            amount: 0n,
            token: 0n,
          },
          meta: { block: { number: 1, time: 86400 } },
        }),
      ).toMatchSnapshot("result of quote after full day");

      expect(
        pool.quote({
          tokenAmount: {
            amount: 0n,
            token: 0n,
          },
          overrideState: first.stateAfter,
          meta: { block: { number: 1, time: 86400 } },
        }),
      ).toMatchSnapshot("result of quote after full day using overrides");
    });

    it("moody testing examples", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(693147), // ~=2
        liquidity: 10n ** 21n, // something like a thousand of each token
        tick: 693147,
        extension: 1n,
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
      });

      expect(
        pool.quote({
          tokenAmount: { token: 0n, amount: 0n },
          meta: { block: { number: 1, time: 60 } },
        }),
      ).toMatchSnapshot("0 seconds pass");

      expect(
        pool.quote({
          tokenAmount: { token: 0n, amount: 0n },
          meta: { block: { number: 1, time: 90 } },
        }),
      ).toMatchSnapshot("30 seconds pass");

      const fullyExecutedTwamm = pool.quote({
        tokenAmount: { token: 0n, amount: 0n },
        meta: { block: { number: 1, time: 120 } },
      });
      expect(fullyExecutedTwamm).toMatchSnapshot("60 seconds pass");

      expect(
        pool.quote({
          tokenAmount: {
            token: 0n,
            amount: 10n ** 18n,
          },
          meta: { block: { number: 1, time: 120 } },
        }).calculatedAmount,
      ).toEqual(
        pool.basePool.quote({
          tokenAmount: {
            token: 0n,
            amount: 10n ** 18n,
          },
          meta: { block: { number: 1, time: 120 } },
          overrideState: fullyExecutedTwamm.stateAfter,
        }).calculatedAmount,
      );

      expect(
        pool.quote({
          tokenAmount: {
            token: 1n,
            amount: 10n ** 18n,
          },
          meta: { block: { number: 1, time: 120 } },
        }).calculatedAmount,
      ).toEqual(
        pool.basePool.quote({
          tokenAmount: {
            token: 1n,
            amount: 10n ** 18n,
          },
          meta: { block: { number: 1, time: 120 } },
          overrideState: fullyExecutedTwamm.stateAfter,
        }).calculatedAmount,
      );
    });

    it("compare to contract output", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(693147),
        liquidity: 70710696755630728101718334n,
        tick: 693147,
        extension: 1n,
        token0SaleRate: 10526880627450980392156862745n,
        token1SaleRate: 10526880627450980392156862745n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const quote = pool.quote({
        tokenAmount: {
          amount: 10_000n * 10n ** 18n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 2040 } },
      });
      expect(quote).toMatchSnapshot("first swap");

      expect(
        pool.quote({
          tokenAmount: {
            amount: 10_000n * 10n ** 18n,
            token: 0n,
          },
          meta: { block: { number: 2, time: 2100 } },
          overrideState: quote.stateAfter,
        }),
      ).toMatchSnapshot("second swap from first");
    });

    it("second swap in opposite direction", () => {
      const pool = new TwammPool({
        token0: 0n,
        token1: 1n,
        fee: 0n,
        sqrtRatio: toSqrtRatio(693147),
        liquidity: 70710696755630728101718334n,
        tick: 693147,
        extension: 1n,
        token0SaleRate: 10526880627450980392156862745n,
        token1SaleRate: 10526880627450980392156862745n,
        lastExecutionTime: 0,
        saleRateDeltas: [],
      });

      const quote = pool.quote({
        tokenAmount: {
          amount: 10_000n * 10n ** 18n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 2040 } },
      });
      expect(quote).toMatchSnapshot("first swap");

      expect(
        pool.quote({
          tokenAmount: {
            amount: 10_000n * 10n ** 18n,
            token: 1n,
          },
          meta: { block: { number: 2, time: 2100 } },
          overrideState: quote.stateAfter,
        }),
      ).toMatchSnapshot("second swap from first");
    });
  });
});
