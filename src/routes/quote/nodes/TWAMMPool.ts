import { MAX_SQRT_RATIO, MAX_TICK_SPACING, MIN_SQRT_RATIO } from "../math/tick";
import { calculateNextSqrtRatio } from "../math/twamm";
import { BasePool } from "./basePool";
import { BaseNodeState, BaseResources, Quote, QuoteParams } from "./quoteNode";

export const MAX_BOUND_USABLE_TICK_MAGNITUDE = 88368108;
const MAX_BOUNDS_MIN_SQRT_RATIO: bigint = 22027144413679976675n;
const MAX_BOUNDS_MAX_SQRT_RATIO: bigint =
  5256790760649093508123362461711849782692726119655358142129n;

export interface TWAMMResources extends BaseResources {
  virtualOrderSecondsExecuted: number;
}

export interface TWAMMSaleRateDeltas {
  saleRateDelta0: bigint;
  saleRateDelta1: bigint;
  time: number;
}

export class TWAMMPool extends BasePool {
  public readonly token0SaleRate: bigint;
  public readonly token1SaleRate: bigint;
  public lastExecutionTime: number;
  public readonly saleRateDeltas: TWAMMSaleRateDeltas[];

  constructor({
    token0,
    token1,
    fee,
    sqrtRatio,
    liquidity,
    tick,
    extension,
    token0SaleRate,
    token1SaleRate,
    lastExecutionTime,
    saleRateDeltas,
  }: {
    token0: bigint;
    token1: bigint;
    fee: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    extension: bigint;
    token0SaleRate: bigint;
    token1SaleRate: bigint;
    lastExecutionTime: number;
    saleRateDeltas: TWAMMSaleRateDeltas[];
  }) {
    super({
      token0,
      token1,
      tickSpacing: MAX_TICK_SPACING,
      fee,
      sqrtRatio,
      liquidity,
      tick,
      sortedTicks: [
        { tick: -MAX_BOUND_USABLE_TICK_MAGNITUDE, liquidityDelta: liquidity },
        { tick: MAX_BOUND_USABLE_TICK_MAGNITUDE, liquidityDelta: -liquidity },
      ],
      extension,
    });

    this.token0SaleRate = token0SaleRate;
    this.token1SaleRate = token1SaleRate;
    this.lastExecutionTime = lastExecutionTime;
    this.saleRateDeltas = saleRateDeltas;
  }

  public quote({
    tokenAmount: { amount, token },
    sqrtRatioLimit,
    overrideSwapState,
    meta,
  }: QuoteParams<BaseNodeState>): Quote<TWAMMResources, BaseNodeState> {
    const { block } = meta;

    const virtualOrderSecondsExecuted = block.time - this.lastExecutionTime;

    let liquidity = this.liquidity;
    let nextSqrtRatio = this.sqrtRatio;
    let lastExecutionTime = this.lastExecutionTime;
    let [token0SaleRate, token1SaleRate] = [
      this.token0SaleRate,
      this.token1SaleRate,
    ];
    const saleRateDeltas: TWAMMSaleRateDeltas[] = this.saleRateDeltas.sort(
      (a, b) => a.time - b.time,
    );
    let twammInitializedTicksCrossed = 0;
    let twammTickSpacingsCrossed = 0;

    while (lastExecutionTime !== block.time) {
      const saleRateDelta = saleRateDeltas.pop();

      const nextExecutionTime = saleRateDelta ? saleRateDelta.time : block.time;

      const timeElapsed = BigInt(nextExecutionTime - lastExecutionTime);

      const [amount0, amount1] = [
        (token0SaleRate * timeElapsed) >> 32n,
        (token1SaleRate * timeElapsed) >> 32n,
      ];

      if (amount0 > 0n && amount1 > 0n) {
        liquidity = max(this.liquidity, liquidity);
        nextSqrtRatio = calculateNextSqrtRatio(
          max(
            MAX_BOUNDS_MIN_SQRT_RATIO,
            min(MAX_BOUNDS_MAX_SQRT_RATIO, nextSqrtRatio),
          ),
          liquidity,
          token0SaleRate,
          token1SaleRate,
          timeElapsed,
        );
      } else if (amount0 > 0n || amount1 > 0n) {
        const [amount, isToken1, sqrtRatioLimit] =
          amount0 !== 0n
            ? [amount0, false, MIN_SQRT_RATIO]
            : [amount1, true, MAX_SQRT_RATIO];

        const { executionResources: twammSwapExecutionResources, stateAfter } =
          super.quote({
            tokenAmount: {
              amount,
              token: isToken1 ? this.key.token1 : this.key.token0,
            },
            sqrtRatioLimit,
            meta,
          });

        nextSqrtRatio = stateAfter.sqrtRatio;

        // if the last swap pushes the price out of range, the pool will have no liquidity
        liquidity = stateAfter.liquidity;

        twammInitializedTicksCrossed +=
          twammSwapExecutionResources.initializedTicksCrossed;
        twammTickSpacingsCrossed +=
          twammSwapExecutionResources.tickSpacingsCrossed;
      }

      if (saleRateDelta) {
        token0SaleRate += saleRateDelta.saleRateDelta0;
        token1SaleRate += saleRateDelta.saleRateDelta1;
      }

      lastExecutionTime = nextExecutionTime;
    }

    this.lastExecutionTime = lastExecutionTime;

    const { consumedAmount, calculatedAmount, executionResources, stateAfter } =
      super.quote({
        tokenAmount: { amount, token },
        sqrtRatioLimit,
        overrideSwapState: {
          sqrtRatio: nextSqrtRatio,
          liquidity,
          activeTickIndex: 0,
        },
        meta,
      });

    if (twammInitializedTicksCrossed > 0 || twammTickSpacingsCrossed > 0) {
      return {
        consumedAmount,
        calculatedAmount,
        executionResources: {
          initializedTicksCrossed:
            executionResources.initializedTicksCrossed +
            twammInitializedTicksCrossed,
          tickSpacingsCrossed:
            executionResources.tickSpacingsCrossed + twammTickSpacingsCrossed,
          virtualOrderSecondsExecuted,
        },
        stateAfter,
      };
    }

    return {
      consumedAmount,
      calculatedAmount,
      executionResources: {
        ...executionResources,
        virtualOrderSecondsExecuted,
      },
      stateAfter,
    };
  }

  public hasLiquidity(): boolean {
    return this.liquidity > 0n;
  }

  get state(): Readonly<BaseNodeState> {
    return {
      activeTickIndex: 0,
      liquidity: this.liquidity,
      sqrtRatio: this.sqrtRatio,
    };
  }
}

function min(x: bigint, y: bigint): bigint {
  return x > y ? y : x;
}

function max(x: bigint, y: bigint): bigint {
  return x > y ? x : y;
}
