export interface BasePoolState {
  sqrtRatio: bigint;
  liquidity: bigint;
  activeTickIndex: number;
}

export interface BasePoolResources {
  initializedTicksCrossed: number;
  tickSpacingsCrossed: number;
}

export interface Quote<
  TResources extends BasePoolResources,
  TState extends BasePoolState,
> {
  consumedAmount: bigint;
  calculatedAmount: bigint;
  isPriceIncreasing: boolean;
  stateAfter: TState;
  executionResources: TResources;
  feesPaid: bigint;
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

export interface QuoteParams<TState extends BasePoolState> {
  tokenAmount: TokenAmount;
  meta: QuoteMeta;
  sqrtRatioLimit?: bigint;
  overrideState?: TState;
}

export interface Tick {
  readonly tick: number;
  readonly liquidityDelta: bigint;
}

export interface QuoteNode<
  TResources extends BasePoolResources = BasePoolResources,
  TSwapState extends BasePoolState = BasePoolState,
> {
  readonly key: NodeKey;
  readonly state: Readonly<TSwapState>;
  readonly sortedTicks: Tick[];

  quote(params: QuoteParams<TSwapState>): Quote<TResources, TSwapState>;

  /**
   * Given resources from two different swaps on the same pool, compute the total resources
   * @param resource the initial resources consumed
   * @param additionalResources the additional resources consumed
   */
  combineResources(
    resource: TResources,
    additionalResources: TResources,
  ): TResources;

  /**
   * Returns the resources consumed by a no-op swap
   */
  initialResources(): TResources;

  /**
   * Returns whether the pool has any useful liquidity at all. Should be a fast check for eliminating empty pools.
   */
  hasLiquidity(): boolean;
}
