import { computeStep, isPriceIncreasing } from "../math/swap";
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from "../math/tick";
import { PoolKey, QuoteNode } from "./quoteNode";
import { numericToHex } from "../format";

export interface Tick {
  readonly liquidityDelta: bigint;
  readonly tick: number;
}

export class PlainPool
  implements QuoteNode<{ initializedTicksCrossed: number }>
{
  // key
  public readonly token0: bigint;
  public readonly token1: bigint;
  public readonly fee: bigint;
  public readonly tickSpacing: number;

  // state
  public readonly sqrtRatio: bigint;
  public readonly liquidity: bigint;
  public readonly tick: number;
  private readonly sortedTicks: Tick[];

  private _poolKey: PoolKey | null = null;

  public get poolKey(): PoolKey {
    return (
      this._poolKey ??
      (this._poolKey = {
        token0: numericToHex(this.token0),
        token1: numericToHex(this.token1),
        fee: numericToHex(this.fee),
        tick_spacing: this.tickSpacing,
        extension: numericToHex(0),
      })
    );
  }

  constructor({
    token0,
    token1,
    tickSpacing,
    fee,
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
  }: {
    token0: bigint;
    token1: bigint;
    tickSpacing: number;
    fee: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    sortedTicks: Tick[];
  }) {
    this.token0 = token0;
    this.token1 = token1;
    this.tickSpacing = tickSpacing;
    this.fee = fee;
    this.sqrtRatio = sqrtRatio;
    this.liquidity = liquidity;
    this.tick = tick;
    this.sortedTicks = sortedTicks;
  }

  // Deferred caching of the binary search result
  private _activeTickIndex: number | null = null;
  public get activeTickIndex(): number {
    return (
      this._activeTickIndex ??
      (this._activeTickIndex = this.findNearestInitializedTickIndex(this.tick))
    );
  }

  /**
   * Returns the index in the sorted tick array that has the greatest value of tick that is not greater than the given tick
   * @param tick the tick to search for
   * @private
   */
  public findNearestInitializedTickIndex(tick: number): number {
    let l = 0,
      r = this.sortedTicks.length;

    while (l < r) {
      const mid = Math.floor((l + r) / 2);
      const midTick = this.sortedTicks[mid].tick;
      if (midTick <= tick) {
        // if it's the last index, or the next tick is greater, we've found our index
        if (
          mid === this.sortedTicks.length - 1 ||
          this.sortedTicks[mid + 1].tick > tick
        ) {
          return mid;
        } else {
          // otherwise our value is to the right of this one
          l = mid;
        }
      } else {
        // the mid tick is greater than the one we want, so we know it's not mid
        r = mid;
      }
    }

    return -1;
  }

  public quote({
    specifiedAmount,
    isToken1,
    sqrtRatioLimit,
  }: {
    specifiedAmount: bigint;
    isToken1: boolean;
    sqrtRatioLimit?: bigint;
  }): {
    consumedAmount: bigint;
    calculatedAmount: bigint;
    executionResources: {
      initializedTicksCrossed: number;
      sqrtRatioAfter: bigint;
    };
  } {
    if (specifiedAmount === 0n) {
      return {
        consumedAmount: 0n,
        calculatedAmount: 0n,
        executionResources: {
          initializedTicksCrossed: 0,
          sqrtRatioAfter: this.sqrtRatio,
        },
      };
    }

    const isIncreasing = isPriceIncreasing(specifiedAmount, isToken1);

    if (sqrtRatioLimit) {
      // validate sqrtRatioLimit
      if (isIncreasing && sqrtRatioLimit < this.sqrtRatio) {
        throw new Error("sqrtRatioLimit cannot be less than sqrtRatio");
      }
      if (!isIncreasing && sqrtRatioLimit > this.sqrtRatio) {
        throw new Error("sqrtRatioLimit cannot be greater than sqrtRatio");
      }
      if (sqrtRatioLimit < MIN_SQRT_RATIO) {
        throw new Error("sqrtRatioLimit lt min");
      }
      if (sqrtRatioLimit > MAX_SQRT_RATIO) {
        throw new Error("sqrtRatioLimit gt max");
      }
    } else {
      sqrtRatioLimit = isIncreasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO;
    }

    let { sqrtRatio, liquidity } = this;

    // the index of the sorted ticks array of the tick that is <= current tick
    let tickIndex = this.activeTickIndex;
    let calculatedAmount: bigint = 0n;
    let initializedTicksCrossed = 0;
    let amountRemaining = specifiedAmount;

    let totalFee: bigint = 0n;

    while (amountRemaining !== 0n && sqrtRatio !== sqrtRatioLimit) {
      const nextInitializedTick: Tick | null =
        (isIncreasing
          ? this.sortedTicks[tickIndex + 1]
          : this.sortedTicks[tickIndex]) ?? null;

      const nextInitializedTickSqrtRatio = nextInitializedTick
        ? toSqrtRatio(nextInitializedTick.tick)
        : null;

      const stepSqrtRatioLimit =
        nextInitializedTickSqrtRatio === null
          ? sqrtRatioLimit
          : nextInitializedTickSqrtRatio < sqrtRatioLimit === isIncreasing
          ? nextInitializedTickSqrtRatio
          : sqrtRatioLimit;

      const step = computeStep({
        fee: this.fee,
        sqrtRatio,
        liquidity,
        isToken1,
        sqrtRatioLimit: stepSqrtRatioLimit,
        amount: amountRemaining,
      });

      amountRemaining -= step.consumedAmount;
      calculatedAmount += step.calculatedAmount;
      totalFee += step.feeAmount;
      sqrtRatio = step.sqrtRatioNext;

      // cross the tick if the price moved all the way to the next initialized tick price
      if (nextInitializedTick && sqrtRatio === nextInitializedTickSqrtRatio) {
        tickIndex = isIncreasing ? tickIndex + 1 : tickIndex - 1;
        initializedTicksCrossed++;
        liquidity += isIncreasing
          ? nextInitializedTick.liquidityDelta
          : -nextInitializedTick.liquidityDelta;
      }
    }

    return {
      consumedAmount: specifiedAmount - amountRemaining,
      calculatedAmount,
      executionResources: {
        initializedTicksCrossed,
        sqrtRatioAfter: sqrtRatio,
      },
    };
  }
}
