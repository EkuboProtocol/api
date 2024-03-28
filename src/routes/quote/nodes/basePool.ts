import { computeStep, isPriceIncreasing } from "../math/swap";
import {
  approximateNumberOfTickSpacingsCrossed,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  toSqrtRatio,
} from "../math/tick";
import {
  BaseNodeState,
  BaseResources,
  NodeKey,
  Quote,
  QuoteNode,
  QuoteParams,
} from "./quoteNode";

export interface Tick {
  readonly liquidityDelta: bigint;
  readonly tick: number;
}

export class BasePool implements QuoteNode {
  public readonly key: NodeKey;

  // state
  public readonly sqrtRatio: bigint;
  public readonly liquidity: bigint;
  public readonly tick: number;
  public readonly sortedTicks: Tick[];

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
    this.key = {
      token0,
      token1,
      fee,
      tickSpacing,
      extension: 0n,
    };
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
    tokenAmount: { amount, token },
    sqrtRatioLimit,
    overrideSwapState,
  }: QuoteParams<BaseNodeState>): Quote<BaseResources, BaseNodeState> {
    const isToken1 = token === this.key.token1;
    if (!isToken1 && this.key.token0 !== token) {
      throw new Error("Invalid token");
    }
    if (amount === 0n) {
      return {
        isPriceIncreasing: isToken1,
        consumedAmount: 0n,
        calculatedAmount: 0n,
        executionResources: {
          tickSpacingsCrossed: 0,
          initializedTicksCrossed: 0,
        },
        stateAfter: overrideSwapState ?? {
          sqrtRatio: this.sqrtRatio,
          liquidity: this.liquidity,
          activeTickIndex: this.activeTickIndex,
        },
      };
    }

    const isIncreasing = isPriceIncreasing(amount, isToken1);

    let sqrtRatio = overrideSwapState?.sqrtRatio ?? this.sqrtRatio;

    if (sqrtRatioLimit) {
      // validate sqrtRatioLimit
      if (isIncreasing && sqrtRatioLimit < sqrtRatio) {
        throw new Error("sqrtRatioLimit cannot be less than sqrtRatio");
      }
      if (!isIncreasing && sqrtRatioLimit > sqrtRatio) {
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

    let liquidity = overrideSwapState?.liquidity ?? this.liquidity;
    let tickIndex = overrideSwapState?.activeTickIndex ?? this.activeTickIndex;

    // the index of the sorted ticks array of the tick that is <= current tick
    let calculatedAmount = 0n;
    let initializedTicksCrossed = 0;
    let amountRemaining = amount;

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
        fee: this.key.fee,
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
      isPriceIncreasing: isIncreasing,
      consumedAmount: amount - amountRemaining,
      calculatedAmount,
      executionResources: {
        initializedTicksCrossed,
        tickSpacingsCrossed: approximateNumberOfTickSpacingsCrossed(
          overrideSwapState?.sqrtRatio ?? this.state.sqrtRatio,
          sqrtRatio,
          this.key.tickSpacing,
        ),
      },
      stateAfter: {
        sqrtRatio,
        liquidity,
        activeTickIndex: tickIndex,
      },
    };
  }

  public hasLiquidity(): boolean {
    return this.liquidity > 0n || this.sortedTicks.length > 0;
  }

  get state(): Readonly<BaseNodeState> {
    return {
      activeTickIndex: this.activeTickIndex,
      liquidity: this.liquidity,
      sqrtRatio: this.sqrtRatio,
    };
  }
}
