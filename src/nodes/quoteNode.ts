import { numericToHex } from "../format";

export interface Quote<T> {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  executionResources: T;
}

export interface PoolKey {
  token0: string;
  token1: string;
  fee: string;
  tick_spacing: number;
  extension: string;
}

export interface QuoteNode<T> {
  token0: bigint;
  token1: bigint;

  poolKey: PoolKey;

  quote(params: {
    specifiedAmount: bigint;
    isToken1: boolean;
    sqrtRatioLimit?: bigint;
  }): Quote<T>;
}
