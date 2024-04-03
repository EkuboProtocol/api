import { MAX_SQRT_RATIO, MAX_TICK_SPACING, MIN_SQRT_RATIO } from "../math/tick";
import { calculateNextSqrtRatio } from "../math/twamm";
import { BasePool } from "./basePool";
import {
  BaseNodeState,
  BaseResources,
  NodeKey,
  Quote,
  QuoteNode,
  QuoteParams,
  Tick,
} from "./quoteNode";
import { MAX_U128 } from "../math/constants";

export const MAX_BOUND_USABLE_TICK_MAGNITUDE = 88368108;
const MAX_BOUNDS_MIN_SQRT_RATIO: bigint = 22027144413679976675n;
const MAX_BOUNDS_MAX_SQRT_RATIO: bigint =
  5256790760649093508123362461711849782692726119655358142129n;

export interface TwammResources extends BaseResources {
  virtualOrderSecondsExecuted: number;
  virtualOrderDeltaTimesCrossed: number;
}

export interface TwammSaleRateDelta {
  saleRateDelta0: bigint;
  saleRateDelta1: bigint;
  time: number;
}

export interface TwammPoolState extends BaseNodeState {
  readonly token0SaleRate: bigint;
  readonly token1SaleRate: bigint;
  readonly lastExecutionTime: number;
}

export class TwammPool implements QuoteNode<TwammResources, TwammPoolState> {
  public get key(): NodeKey {
    return { ...this.basePool.key, extension: this.extension };
  }

  public get sortedTicks(): Tick[] {
    return this.basePool.sortedTicks;
  }

  private readonly extension: bigint;
  private readonly basePool: BasePool;

  // state
  public readonly token0SaleRate: bigint;
  public readonly token1SaleRate: bigint;
  public readonly lastExecutionTime: number;
  public readonly saleRateDeltas: Readonly<TwammSaleRateDelta[]>;

  constructor({
    token0,
    token1,
    fee,
    extension,

    sqrtRatio,
    liquidity,
    tick,

    token0SaleRate,
    token1SaleRate,
    lastExecutionTime,
    saleRateDeltas,
  }: {
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
    saleRateDeltas: TwammSaleRateDelta[];
  }) {
    this.extension = extension;
    this.basePool = new BasePool({
      token0,
      token1,
      fee,
      sqrtRatio,
      liquidity,
      tick,
      tickSpacing: MAX_TICK_SPACING,
      sortedTicks: [
        { tick: -MAX_BOUND_USABLE_TICK_MAGNITUDE, liquidityDelta: liquidity },
        { tick: MAX_BOUND_USABLE_TICK_MAGNITUDE, liquidityDelta: -liquidity },
      ],
    });

    this.token0SaleRate = token0SaleRate;
    this.token1SaleRate = token1SaleRate;
    this.lastExecutionTime = lastExecutionTime;
    this.saleRateDeltas = saleRateDeltas;
  }

  public quote({
    tokenAmount,
    sqrtRatioLimit,
    overrides,
    meta,
  }: QuoteParams<TwammResources, TwammPoolState>): Quote<
    TwammResources,
    TwammPoolState
  > {
    const {
      block: { time: currentTime },
    } = meta;

    const initialState = overrides?.state ?? this.state;

    let {
      liquidity,
      sqrtRatio: nextSqrtRatio,
      token0SaleRate,
      token1SaleRate,
      lastExecutionTime,
    } = initialState;

    const virtualOrderSecondsExecuted =
      currentTime -
      lastExecutionTime +
      (overrides?.resources.virtualOrderSecondsExecuted ?? 0);
    if (virtualOrderSecondsExecuted < 0)
      throw new Error("Last execution time exceeds block time");

    let virtualOrderDeltaTimesCrossed: number =
      overrides?.resources?.virtualOrderDeltaTimesCrossed ?? 0;

    let nextSaleRateDeltaIndex = this.saleRateDeltas.findIndex(
      (srd) => srd.time > lastExecutionTime,
    );

    // this is the current state of the base pool during the iteration
    let basePoolOverrides:
      | { state: BaseNodeState; resources: BaseResources }
      | undefined = overrides;

    while (lastExecutionTime !== currentTime) {
      const saleRateDelta = this.saleRateDeltas[nextSaleRateDeltaIndex];
      const nextExecutionTime = saleRateDelta
        ? Math.min(saleRateDelta.time, currentTime)
        : currentTime;

      const timeElapsed = BigInt(nextExecutionTime - lastExecutionTime);

      const [amount0, amount1] = [
        (token0SaleRate * timeElapsed) >> 32n,
        (token1SaleRate * timeElapsed) >> 32n,
      ];

      if (amount0 > 0n && amount1 > 0n) {
        liquidity = max(this.basePool.state.liquidity, liquidity);

        const currentSqrtRatio = max(
          MAX_BOUNDS_MIN_SQRT_RATIO,
          min(MAX_BOUNDS_MAX_SQRT_RATIO, nextSqrtRatio),
        );

        nextSqrtRatio = calculateNextSqrtRatio(
          currentSqrtRatio,
          liquidity,
          token0SaleRate,
          token1SaleRate,
          timeElapsed,
        );

        const quote = this.basePool.quote({
          tokenAmount: {
            amount: -MAX_U128,
            token:
              currentSqrtRatio >= nextSqrtRatio
                ? this.basePool.key.token1
                : this.basePool.key.token0,
          },
          sqrtRatioLimit: nextSqrtRatio,
          meta,
          overrides: basePoolOverrides,
        });

        basePoolOverrides = {
          state: quote.stateAfter,
          resources: quote.executionResources,
        };
      } else if (amount0 > 0n || amount1 > 0n) {
        const [amount, isToken1, sqrtRatioLimit] =
          amount0 !== 0n
            ? [amount0, false, MIN_SQRT_RATIO]
            : [amount1, true, MAX_SQRT_RATIO];

        const quote = this.basePool.quote({
          tokenAmount: {
            amount,
            token: isToken1
              ? this.basePool.key.token1
              : this.basePool.key.token0,
          },
          sqrtRatioLimit,
          meta,
          overrides: basePoolOverrides,
        });

        basePoolOverrides = {
          state: quote.stateAfter,
          resources: quote.executionResources,
        };

        nextSqrtRatio = basePoolOverrides.state.sqrtRatio;
      }

      // if the last swap pushes the price out of range, the pool will have no liquidity
      liquidity = basePoolOverrides?.state.liquidity;

      // if we executed up to the next sale rate delta, we need to apply the delta
      if (nextExecutionTime === saleRateDelta?.time) {
        token0SaleRate += saleRateDelta.saleRateDelta0;
        token1SaleRate += saleRateDelta.saleRateDelta1;
        nextSaleRateDeltaIndex++;
        virtualOrderDeltaTimesCrossed++;
      }

      lastExecutionTime = nextExecutionTime;
    }

    const {
      consumedAmount,
      calculatedAmount,
      executionResources,
      stateAfter,
      isPriceIncreasing,
    } = this.basePool.quote({
      tokenAmount,
      sqrtRatioLimit,
      meta,
      overrides: basePoolOverrides,
    });

    basePoolOverrides = {
      state: stateAfter,
      resources: executionResources,
    };

    return {
      isPriceIncreasing,
      consumedAmount,
      calculatedAmount,
      executionResources: {
        initializedTicksCrossed: 0,
        tickSpacingsCrossed: 0,
        ...basePoolOverrides.resources,
        virtualOrderSecondsExecuted,
        virtualOrderDeltaTimesCrossed,
      },
      stateAfter: {
        ...basePoolOverrides.state,
        token0SaleRate,
        token1SaleRate,
        lastExecutionTime: currentTime,
      },
    };
  }

  public hasLiquidity(): boolean {
    return this.basePool.hasLiquidity();
  }

  get state(): Readonly<TwammPoolState> {
    return {
      ...this.basePool.state,
      token0SaleRate: this.token0SaleRate,
      token1SaleRate: this.token1SaleRate,
      lastExecutionTime: this.lastExecutionTime,
    };
  }
}

function min(x: bigint, y: bigint): bigint {
  return x > y ? y : x;
}

function max(x: bigint, y: bigint): bigint {
  return x > y ? x : y;
}
