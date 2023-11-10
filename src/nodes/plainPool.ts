import { computeStep, isPriceIncreasing } from "../math/swap";
import { toSqrtRatio } from "../math/tick";
import { Node } from "../quoting";

export interface Tick {
  readonly liquidity_delta: bigint;
  readonly tick: number;
}

export class PlainPool implements Node<{ initializedTicksCrossed: number }> {
  public static readonly MAX_SQRT_RATIO: bigint =
    6277100250585753475930931601400621808602321654880405518632n;
  public static readonly MIN_SQRT_RATIO: bigint = 18446748437148339061n;
  public static readonly MIN_TICK: number = -88722883;
  public static readonly MAX_TICK: number = 88722883;

  private readonly fee: bigint;
  private readonly sqrtRatio: bigint;
  private readonly liquidity: bigint;
  private readonly tick: number;
  private readonly sortedTicks: Tick[];

  constructor({
    fee,
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
  }: {
    fee: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    sortedTicks: Tick[];
  }) {
    this.fee = fee;
    this.sqrtRatio = sqrtRatio;
    this.liquidity = liquidity;
    this.tick = tick;
    this.sortedTicks = sortedTicks;
  }

  /**
   * Returns the index in the sorted tick array that has the greatest value of tick that is not greater than the given tick
   * @param tick the tick to search for
   * @private
   */
  public findNearestInitializedTickIndex(tick: number): number | null {
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

    return null;
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
        executionResources: {
          initializedTicksCrossed: 0,
          sqrtRatioAfter: this.sqrtRatio,
        },
        calculatedAmount: 0n,
      };
    }

    const isIncreasing = isPriceIncreasing(specifiedAmount, isToken1);

    if (typeof sqrtRatioLimit === "bigint") {
      // validate sqrtRatioLimit
      if (isIncreasing && sqrtRatioLimit < this.sqrtRatio) {
        throw new Error("sqrtRatioLimit cannot be less than sqrtRatio");
      }
      if (!isIncreasing && sqrtRatioLimit > this.sqrtRatio) {
        throw new Error("sqrtRatioLimit cannot be greater than sqrtRatio");
      }
      if (sqrtRatioLimit > PlainPool.MAX_SQRT_RATIO) {
        throw new Error("sqrtRatioLimit gt max");
      }
      if (sqrtRatioLimit < PlainPool.MIN_SQRT_RATIO) {
        throw new Error("sqrtRatioLimit lt min");
      }
    } else {
      sqrtRatioLimit = isIncreasing
        ? PlainPool.MAX_SQRT_RATIO
        : PlainPool.MIN_SQRT_RATIO;
    }

    let { sqrtRatio, liquidity } = this;

    // the index of the sorted ticks array of the tick that is <= current tick
    let activeTickIndex = this.findNearestInitializedTickIndex(this.tick);
    let calculatedAmount: bigint = 0n;
    let initializedTicksCrossed = 0;
    let amountRemaining = specifiedAmount;

    let totalFee: bigint = 0n;

    while (amountRemaining !== 0n && sqrtRatio !== sqrtRatioLimit) {
      const nextInitializedTick = activeTickIndex
        ? isIncreasing
          ? this.sortedTicks[activeTickIndex + 1]
          : this.sortedTicks[activeTickIndex]
        : null;

      const nextTickSqrtRatio = nextInitializedTick
        ? toSqrtRatio(nextInitializedTick.tick)
        : isIncreasing
        ? PlainPool.MAX_SQRT_RATIO
        : PlainPool.MIN_SQRT_RATIO;

      const isLimited =
        (isIncreasing && nextTickSqrtRatio > sqrtRatioLimit) ||
        (!isIncreasing && nextTickSqrtRatio < sqrtRatioLimit);

      const nextSqrtRatioLimit = isLimited ? sqrtRatioLimit : nextTickSqrtRatio;

      const step = computeStep({
        sqrtRatio,
        liquidity,
        isToken1,
        fee: this.fee,
        sqrtRatioLimit: nextSqrtRatioLimit,
        amount: specifiedAmount,
      });

      amountRemaining -= step.consumedAmount;
      calculatedAmount += step.calculatedAmount;
      totalFee += step.feeAmount;
      sqrtRatio = step.sqrtRatioNext;

      // cross the tick if the price moved all the way to the next initialized tick price
      if (
        sqrtRatio === nextTickSqrtRatio &&
        nextInitializedTick &&
        activeTickIndex
      ) {
        activeTickIndex = isIncreasing
          ? activeTickIndex + 1
          : activeTickIndex - 1;
        initializedTicksCrossed++;
        liquidity += isIncreasing
          ? nextInitializedTick.liquidity_delta
          : -nextInitializedTick.liquidity_delta;
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
