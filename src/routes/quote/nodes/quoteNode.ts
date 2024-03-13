export interface BaseNodeState {
  sqrtRatio: bigint;
  liquidity: bigint;
  activeTickIndex: number;
}

export interface BaseResources {
  initializedTicksCrossed: number;
  tickSpacingsCrossed: number;
}

export interface Quote<
  TResources extends BaseResources,
  TState extends BaseNodeState,
> {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  executionResources: TResources;
  stateAfter: TState;
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

export interface QuoteParams<T extends BaseNodeState> {
  tokenAmount: TokenAmount;
  sqrtRatioLimit?: bigint;
  overrideSwapState?: T;
}

export interface QuoteNode<
  TResources extends BaseResources = BaseResources,
  TSwapState extends BaseNodeState = BaseNodeState,
> {
  readonly key: NodeKey;
  readonly state: Readonly<BaseNodeState>;

  quote(params: QuoteParams<TSwapState>): Quote<TResources, TSwapState>;
  
  hasLiquidity(): boolean;
}
