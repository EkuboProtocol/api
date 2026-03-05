import {
  calculateNextSqrtRatio,
  computeStep,
  EVM_MAX_SQRT_RATIO,
  EVM_MAX_TICK_SPACING,
  EVM_MIN_SQRT_RATIO,
  STARKNET_MAX_SQRT_RATIO,
  STARKNET_MAX_TICK_SPACING,
  STARKNET_MIN_SQRT_RATIO,
  toSqrtRatio,
} from "@ekubo/sdk";

const STARKNET_CHAIN_PREFIX = "534e5f";

type ChainKind = "evm" | "starknet";

const MAX_BOUNDS_MIN_SQRT_RATIO = 22027144413679976675n;
const MAX_BOUNDS_MAX_SQRT_RATIO =
  5256790760649093508123362461711849782692726119655358142129n;

interface ChainParams {
  MAX_TICK_SPACING: number;
  MIN_SQRT_RATIO: bigint;
  MAX_SQRT_RATIO: bigint;
}

const CHAIN_PARAMS: Record<ChainKind, ChainParams> = {
  evm: {
    MAX_TICK_SPACING: EVM_MAX_TICK_SPACING,
    MIN_SQRT_RATIO: EVM_MIN_SQRT_RATIO,
    MAX_SQRT_RATIO: EVM_MAX_SQRT_RATIO,
  },
  starknet: {
    MAX_TICK_SPACING: STARKNET_MAX_TICK_SPACING,
    MIN_SQRT_RATIO: STARKNET_MIN_SQRT_RATIO,
    MAX_SQRT_RATIO: STARKNET_MAX_SQRT_RATIO,
  },
};

interface Tick {
  tick: number;
  liquidityDelta: bigint;
}

interface TwammSaleRateDelta {
  saleRateDelta0: bigint;
  saleRateDelta1: bigint;
  time: number;
}

interface BasePoolState {
  sqrtRatio: bigint;
  liquidity: bigint;
  activeTickIndex: number;
}

interface TwammPoolState {
  sqrtRatio: bigint;
  liquidity: bigint;
  activeTickIndex: number;
  token0SaleRate: bigint;
  token1SaleRate: bigint;
  lastExecutionTime: number;
}

export interface ProjectTwammPoolStateAtTimeParams {
  chainId: bigint;
  token0: bigint;
  token1: bigint;
  fee: bigint;
  sqrtRatio: bigint;
  liquidity: bigint;
  tick: number;
  token0SaleRate: bigint;
  token1SaleRate: bigint;
  lastExecutionTime: number;
  sortedTicks: Tick[];
  saleRateDeltas: TwammSaleRateDelta[];
  targetTime: number;
}

function getChainKind(chainId: bigint): ChainKind {
  return chainId.toString(16).startsWith(STARKNET_CHAIN_PREFIX)
    ? "starknet"
    : "evm";
}

function isPriceIncreasing(amount: bigint, isToken1: boolean): boolean {
  return amount < 0n !== isToken1;
}

function findNearestInitializedTickIndex(sortedTicks: Tick[], tick: number): number {
  let left = 0;
  let right = sortedTicks.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const midTick = sortedTicks[mid].tick;

    if (midTick <= tick) {
      if (mid === sortedTicks.length - 1 || sortedTicks[mid + 1].tick > tick) {
        return mid;
      }

      left = mid;
    } else {
      right = mid;
    }
  }

  return -1;
}

class BasePoolProjector {
  readonly token0: bigint;
  readonly token1: bigint;
  readonly fee: bigint;
  readonly sortedTicks: Tick[];
  readonly chain: ChainKind;
  readonly state: Readonly<BasePoolState>;

  constructor({
    token0,
    token1,
    fee,
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
    chain,
  }: {
    token0: bigint;
    token1: bigint;
    fee: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    sortedTicks: Tick[];
    chain: ChainKind;
  }) {
    this.chain = chain;
    this.token0 = token0;
    this.token1 = token1;
    this.fee = fee;
    this.sortedTicks = sortedTicks;

    this.state = {
      sqrtRatio,
      liquidity,
      activeTickIndex: findNearestInitializedTickIndex(sortedTicks, tick),
    };
  }

  quoteStateAfter({
    amount,
    token,
    sqrtRatioLimit,
    state,
  }: {
    amount: bigint;
    token: bigint;
    sqrtRatioLimit: bigint;
    state: BasePoolState;
  }): BasePoolState {
    const { MIN_SQRT_RATIO, MAX_SQRT_RATIO } = CHAIN_PARAMS[this.chain];

    const isToken1 = token === this.token1;
    if (!isToken1 && token !== this.token0) {
      throw new Error("Invalid token");
    }

    if (amount === 0n) {
      return state;
    }

    const isIncreasing = isPriceIncreasing(amount, isToken1);

    let { sqrtRatio, liquidity, activeTickIndex } = state;

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

    let amountRemaining = amount;

    while (amountRemaining !== 0n && sqrtRatio !== sqrtRatioLimit) {
      const nextInitializedTick: Tick | null =
        (isIncreasing
          ? this.sortedTicks[activeTickIndex + 1]
          : this.sortedTicks[activeTickIndex]) ?? null;

      const nextInitializedTickSqrtRatio = nextInitializedTick
        ? toSqrtRatio(nextInitializedTick.tick, this.chain)
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
      sqrtRatio = step.sqrtRatioNext;

      if (nextInitializedTick && sqrtRatio === nextInitializedTickSqrtRatio) {
        activeTickIndex = isIncreasing
          ? activeTickIndex + 1
          : activeTickIndex - 1;

        liquidity += isIncreasing
          ? nextInitializedTick.liquidityDelta
          : -nextInitializedTick.liquidityDelta;
      }
    }

    return {
      sqrtRatio,
      liquidity,
      activeTickIndex,
    };
  }
}

function minBigInt(x: bigint, y: bigint): bigint {
  return x < y ? x : y;
}

function maxBigInt(x: bigint, y: bigint): bigint {
  return x > y ? x : y;
}

export function projectTwammPoolStateAtTime({
  chainId,
  token0,
  token1,
  fee,
  sqrtRatio,
  liquidity,
  tick,
  token0SaleRate,
  token1SaleRate,
  lastExecutionTime,
  sortedTicks,
  saleRateDeltas,
  targetTime,
}: ProjectTwammPoolStateAtTimeParams): TwammPoolState {
  if (targetTime < lastExecutionTime) {
    throw new Error("Last execution time exceeds target time");
  }

  const chain = getChainKind(chainId);
  const { MIN_SQRT_RATIO, MAX_SQRT_RATIO } = CHAIN_PARAMS[chain];

  const basePool = new BasePoolProjector({
    token0,
    token1,
    fee,
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
    chain,
  });

  let nextSqrtRatio = sqrtRatio;
  let nextToken0SaleRate = token0SaleRate;
  let nextToken1SaleRate = token1SaleRate;
  let nextLastExecutionTime = lastExecutionTime;

  let basePoolStateOverride: BasePoolState = {
    ...basePool.state,
  };

  let nextSaleRateDeltaIndex = saleRateDeltas.findIndex(
    (delta) => delta.time > nextLastExecutionTime,
  );

  while (nextLastExecutionTime !== targetTime) {
    const saleRateDelta = saleRateDeltas[nextSaleRateDeltaIndex];
    const nextExecutionTime = saleRateDelta
      ? Math.min(saleRateDelta.time, targetTime)
      : targetTime;

    const timeElapsed = BigInt(nextExecutionTime - nextLastExecutionTime);

    const amount0 = (nextToken0SaleRate * timeElapsed) >> 32n;
    const amount1 = (nextToken1SaleRate * timeElapsed) >> 32n;

    if (amount0 > 0n && amount1 > 0n) {
      const currentSqrtRatio = maxBigInt(
        MAX_BOUNDS_MIN_SQRT_RATIO,
        minBigInt(MAX_BOUNDS_MAX_SQRT_RATIO, nextSqrtRatio),
      );

      nextSqrtRatio = calculateNextSqrtRatio(
        currentSqrtRatio,
        basePool.sortedTicks[0].liquidityDelta,
        nextToken0SaleRate,
        nextToken1SaleRate,
        timeElapsed,
        fee,
      );

      const token = currentSqrtRatio < nextSqrtRatio ? token1 : token0;
      const amount = currentSqrtRatio < nextSqrtRatio ? amount1 : amount0;

      basePoolStateOverride = basePool.quoteStateAfter({
        amount,
        token,
        sqrtRatioLimit: nextSqrtRatio,
        state: basePoolStateOverride,
      });
    } else if (amount0 > 0n || amount1 > 0n) {
      const amount = amount0 !== 0n ? amount0 : amount1;
      const token = amount0 !== 0n ? token0 : token1;
      const sqrtRatioLimit = amount0 !== 0n ? MIN_SQRT_RATIO : MAX_SQRT_RATIO;

      basePoolStateOverride = basePool.quoteStateAfter({
        amount,
        token,
        sqrtRatioLimit,
        state: basePoolStateOverride,
      });

      nextSqrtRatio = basePoolStateOverride.sqrtRatio;
    }

    if (nextExecutionTime === saleRateDelta?.time) {
      nextToken0SaleRate += saleRateDelta.saleRateDelta0;
      nextToken1SaleRate += saleRateDelta.saleRateDelta1;
      nextSaleRateDeltaIndex++;
    }

    nextLastExecutionTime = nextExecutionTime;
  }

  return {
    ...basePoolStateOverride,
    token0SaleRate: nextToken0SaleRate,
    token1SaleRate: nextToken1SaleRate,
    lastExecutionTime: nextLastExecutionTime,
  };
}
