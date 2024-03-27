import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from "../math/tick";
import { MAX_BOUND_USABLE_TICK_MAGNITUDE, TwammPool } from "./twammPool";

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
  });
});
