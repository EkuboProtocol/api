export interface QuoteNode<T> {
  token0: bigint;
  token1: bigint;

  quote(params: {
    specifiedAmount: bigint;
    isToken1: boolean;
    sqrtRatioLimit?: bigint;
  }): {
    consumedAmount: bigint;
    calculatedAmount: bigint;
    executionResources: T;
  };
}
