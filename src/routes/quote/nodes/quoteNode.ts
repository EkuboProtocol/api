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

export interface TokenAmount {
  token: bigint;
  amount: bigint;
}

export interface QuoteNode<TResources> {
  readonly key: NodeKey;

  quote(params: {
    amount: TokenAmount;
    sqrtRatioLimit?: bigint;
  }): Quote<TResources>;

  hasLiquidity(): boolean;

  suggestedSqrtRatioLimit(params: {
    amount: TokenAmount;
    isToken1: boolean;
  }): bigint;
}
