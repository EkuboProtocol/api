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
} from "./quoteNode";

export const MAX_BOUND_USABLE_TICK_MAGNITUDE = 88368108;
const MAX_BOUNDS_MIN_SQRT_RATIO: bigint = 22027144413679976675n;
const MAX_BOUNDS_MAX_SQRT_RATIO: bigint =
  5256790760649093508123362461711849782692726119655358142129n;

export interface TwammResources extends BaseResources {
  virtualOrderSecondsExecuted: number;
}

export interface TwammSaleRateDelta {
  saleRateDelta0: bigint;
  saleRateDelta1: bigint;
  time: number;
}

export interface TwammPoolState extends BaseNodeState {
  readonly token0SaleRate: bigint;
  readonly token1SaleRate: bigint;
  lastExecutionTime: number;
}

export class TwammPool implements QuoteNode<TwammResources, TwammPoolState> {
  public get key(): NodeKey {
    return { ...this.pool.key, extension: this.extension };
  }

  private readonly extension: bigint;
  private readonly pool: BasePool;

  // state
  public readonly token0SaleRate: bigint;
  public readonly token1SaleRate: bigint;
  public readonly lastExecutionTime: number;
  public readonly saleRateDeltas: Readonly<TwammSaleRateDelta[]>;

  constructor({
    token0,
    token1,
    fee,
    sqrtRatio,
    liquidity,
    tick,
    token0SaleRate,
    token1SaleRate,
    lastExecutionTime,
    saleRateDeltas,
    extension,
  }: {
    token0: bigint;
    token1: bigint;
    fee: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    token0SaleRate: bigint;
    token1SaleRate: bigint;
    lastExecutionTime: number;
    saleRateDeltas: TwammSaleRateDelta[];
    extension: bigint;
  }) {
    this.extension = extension;
    this.pool = new BasePool({
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
  }: QuoteParams<TwammPoolState>): Quote<TwammResources, TwammPoolState> {
    const { block } = meta;

    let lastExecutionTime =
      overrideSwapState?.lastExecutionTime ?? this.lastExecutionTime;

    const virtualOrderSecondsExecuted = block.time - lastExecutionTime;
    if (virtualOrderSecondsExecuted < 0)
      throw new Error("Last execution time exceeds block time");

    let liquidity = overrideSwapState?.liquidity ?? this.pool.liquidity;
    let nextSqrtRatio = overrideSwapState?.sqrtRatio ?? this.pool.sqrtRatio;
    let [token0SaleRate, token1SaleRate] = [
      overrideSwapState?.token0SaleRate ?? this.token0SaleRate,
      overrideSwapState?.token1SaleRate ?? this.token1SaleRate,
    ];
    let twammInitializedTicksCrossed = 0;
    let twammTickSpacingsCrossed = 0;

    // cache this
    let saleRateDeltaIndex = this.saleRateDeltas.findIndex(
      (srd) => srd.time > lastExecutionTime,
    );

    while (lastExecutionTime !== block.time) {
      const saleRateDelta = this.saleRateDeltas[saleRateDeltaIndex];

      const nextExecutionTime = saleRateDelta ? saleRateDelta.time : block.time;

      const timeElapsed = BigInt(nextExecutionTime - lastExecutionTime);

      const [amount0, amount1] = [
        (token0SaleRate * timeElapsed) >> 32n,
        (token1SaleRate * timeElapsed) >> 32n,
      ];

      if (amount0 > 0n && amount1 > 0n) {
        liquidity = max(this.pool.liquidity, liquidity);
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
          this.pool.quote({
            tokenAmount: {
              amount,
              token: isToken1 ? this.pool.key.token1 : this.pool.key.token0,
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
        saleRateDeltaIndex++;
      }

      lastExecutionTime = nextExecutionTime;
    }

    const { consumedAmount, calculatedAmount, executionResources, stateAfter } =
      this.pool.quote({
        tokenAmount: { amount, token },
        sqrtRatioLimit,
        overrideSwapState: {
          sqrtRatio: nextSqrtRatio,
          liquidity,
          activeTickIndex: 0,
        },
        meta,
      });

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
      stateAfter: {
        ...stateAfter,
        token0SaleRate,
        token1SaleRate,
        lastExecutionTime: meta.block.time,
      } as TwammPoolState,
    };
  }

  public hasLiquidity(): boolean {
    return this.pool.hasLiquidity();
  }

  get state(): Readonly<TwammPoolState> {
    return {
      ...this.pool.state,
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
