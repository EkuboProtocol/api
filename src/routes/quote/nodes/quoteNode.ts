export interface SwapState {
  sqrtRatio: bigint;
  liquidity: bigint;
  activeTickIndex: number;
}

export interface Quote<TResources> {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  executionResources: TResources;
  stateAfter: SwapState;
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

export interface SuggestSqrtRatioLimitParams {
  tokenAmount: TokenAmount;
  isToken1: boolean;
}

export interface QuoteParams {
  tokenAmount: TokenAmount;
  sqrtRatioLimit?: bigint;
  overrideSwapState?: SwapState;
}

export interface QuoteNode<TResources> {
  readonly key: NodeKey;

  quote(params: QuoteParams): Quote<TResources>;

  hasLiquidity(): boolean;

  suggestedSqrtRatioLimit(params: SuggestSqrtRatioLimitParams): bigint;
}
