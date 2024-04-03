import {
  BaseNodeState,
  BaseResources,
  Quote,
  QuoteMeta,
  QuoteNode,
  TokenAmount,
} from "./nodes/quoteNode";

export interface GasEstimator<
  TResources extends BaseResources,
  TState extends BaseNodeState,
  TQuoteNode extends QuoteNode<TResources, TState>,
> {
  getGasAdjustedAmount(
    calculatedAmount: bigint,
    route: TQuoteNode[],
    quoteResults: Quote<TResources, TState>[],
    overrides: WeakMap<TQuoteNode, { state: TState; resources: TResources }>,
  ): bigint;
}

export interface QuoteRouteResult<
  TResources extends BaseResources,
  TState extends BaseNodeState,
> {
  calculatedAmount: TokenAmount;
  gasAdjustedCalculatedAmount: bigint;
  quotes: Quote<TResources, TState>[];
}

/**
 * Quotes a single route, and also computes the gas adjusted amount using the given gas estimator
 * @param specifiedAmount
 * @param route
 * @param gasEstimator
 * @param poolStateOverrides
 */
export function quoteRoute<
  TResources extends BaseResources,
  TState extends BaseNodeState,
  TQuoteNode extends QuoteNode<TResources, TState>,
>({
  specifiedAmount,
  route,
  gasEstimator,
  overrides,
  meta,
}: {
  specifiedAmount: TokenAmount;
  route: TQuoteNode[];
  gasEstimator: GasEstimator<TResources, TState, TQuoteNode>;
  overrides: WeakMap<TQuoteNode, { state: TState; resources: TResources }>;
  meta: QuoteMeta;
}): Readonly<QuoteRouteResult<TResources, TState>> | null {
  const isExactOutput = specifiedAmount.amount < 0n;
  const { quotes, calculatedAmount } = route.reduce<{
    quotes: Quote<TResources, TState>[];
    calculatedAmount: TokenAmount;
  }>(
    (state, node) => {
      const isToken1 = node.key.token1 === state.calculatedAmount.token;

      const quote = node.quote({
        tokenAmount: state.calculatedAmount,
        overrides: overrides.get(node),
        meta,
      });

      if (quote.consumedAmount !== state.calculatedAmount.amount) {
        // partial swaps through a route are not supported
        throw new Error("Did not consume entire amount");
      }

      const nextToken = BigInt(isToken1 ? node.key.token0 : node.key.token1);

      state.quotes.push(quote);

      return {
        calculatedAmount: {
          amount: isExactOutput
            ? -quote.calculatedAmount
            : quote.calculatedAmount,
          token: nextToken,
        },
        quotes: state.quotes,
      };
    },
    {
      calculatedAmount: specifiedAmount,
      quotes: [],
    },
  );

  return {
    calculatedAmount,
    quotes,
    gasAdjustedCalculatedAmount: gasEstimator.getGasAdjustedAmount(
      calculatedAmount.amount,
      route,
      quotes,
      overrides,
    ),
  };
}
