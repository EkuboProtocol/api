export interface Quote<TResources> {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  executionResources: TResources;
}

export interface BaseResources {
  initializedTicksCrossed: number;
}

export interface NodeKey {
  readonly token0: bigint;
  readonly token1: bigint;
  readonly fee: bigint;
  readonly tickSpacing: number;
  readonly extension: bigint;
}

export interface QuoteNode<TResources> {
  readonly key: NodeKey;

  quote(params: {
    specifiedAmount: bigint;
    isToken1: boolean;
    sqrtRatioLimit?: bigint;
  }): Quote<TResources>;

  hasLiquidity(): boolean;
}
