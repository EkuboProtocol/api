interface Node<T> {
  quote(
    specifiedAmount: bigint,
    isToken1: boolean,
    sqrtRatioLimit?: bigint
  ): { calculatedAmount: bigint; executionResources: T };
}

interface Tick {
  liquidity_delta: bigint;
  tick: number;
}

class PlainPool
  implements Node<{ initializedTicksCrossed: number; tickBitmapsRead: number }>
{
  private readonly sqrtRatio: bigint;
  private readonly liquidity: bigint;
  private readonly tick: number;
  private readonly sortedTicks: Tick[];

  constructor({
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
  }: {
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    sortedTicks: Tick[];
  }) {
    this.sqrtRatio = sqrtRatio;
    this.liquidity = liquidity;
    this.tick = tick;
    this.sortedTicks = sortedTicks;
  }

  quote(
    specifiedAmount: bigint,
    isToken1: boolean,
    sqrtRatioLimit?: bigint
  ): {
    calculatedAmount: bigint;
    executionResources: {
      initializedTicksCrossed: number;
      tickBitmapsRead: number;
    };
  } {
    const isIncreasing = isToken1 === specifiedAmount >= 0n;

    throw new Error("Method not implemented.");
  }
}
