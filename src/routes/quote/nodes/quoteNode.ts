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
  isPriceIncreasing: boolean;
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

export interface Block {
  readonly number: number;
  readonly time: number;
}

export interface QuoteMeta {
  readonly block: Block;
}

export interface QuoteParams<
  TResources extends BaseResources,
  TState extends BaseNodeState,
> {
  tokenAmount: TokenAmount;
  sqrtRatioLimit?: bigint;
  meta: QuoteMeta;
  overrides?: { state: TState; resources: TResources };
}

export interface Tick {
  readonly tick: number;
  readonly liquidityDelta: bigint;
}

export interface QuoteNode<
  TResources extends BaseResources = BaseResources,
  TSwapState extends BaseNodeState = BaseNodeState,
> {
  readonly key: NodeKey;
  readonly state: Readonly<TSwapState>;
  readonly sortedTicks: Tick[];

  quote(
    params: QuoteParams<TResources, TSwapState>,
  ): Quote<TResources, TSwapState>;

  hasLiquidity(): boolean;
}
