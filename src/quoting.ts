export interface Node<T> {
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
